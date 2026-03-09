#!/usr/bin/env npx tsx
/**
 * decohere — alkahest-powered type design assistant.
 *
 * Finds @decohere-annotated types in src/, generates parsimonious TypeScript
 * definitions using an Otter-style saturation loop over usage evidence.
 *
 * Run: npm run decohere
 * Set DECOHERE_MODEL to control the AI backend (default: local)
 *
 * How it works:
 *   1. Scan src/ for @decohere-annotated types. Extract JSDoc prose + TS
 *      compiler API usage patterns as facts.
 *   2. Run an Otter saturation loop: facts are the set of support. Each step
 *      combines the current focus-fact with the latest type proposal, adding
 *      only what the new fact requires.
 *   3. Validate with tsc on [prior types + proposed type + usage spec functions].
 *      The spec is the oracle: if real usage code compiles, the type is complete.
 *   4. Minimize: try removing each field. If validation still passes, the field
 *      was unnecessary. What remains is parsimonious — every field is grounded
 *      in evidence.
 *
 * Usage spec: write scripts/*-usage-spec.ts showing how you'd use the types
 * once they're real. Decohere extracts the shape from your intentions.
 *
 * Never runs on student data. Dev-time only.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { execSync } from "child_process"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { globSync } from "glob"
import ts from "typescript"
import { makeItem } from "alkahest-ts"
import type { Item } from "alkahest-ts"
import { resolveCombiner, type Combiner } from "./combiners.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const GENERATED_DIR = join(ROOT, "src", "generated")
const TEMP_DIR = join(ROOT, ".decohere-tmp")

// --- Target definition ---

type Phase = "volatile" | "fluid" | "salt"

interface DecohereTarget {
  name: string
  kind: "type" | "interface"
  phase: Phase
  pinnedFields: string  // fields already declared in extends — decohere must preserve these
  sourceFile: string    // path to source file — needed for Salt in-place replacement
  usages: string[]      // inferred from TS compiler API
  specCode: string      // usage spec functions for this type — the validation oracle
  downstreamContexts: string[]
}

// --- TS compiler API: build program ---
//
// Includes src/ AND scripts/ — usage specs live in scripts/ outside the app build.
// Loose options: we want the AST, not strict type-correctness.

function buildProgram(): ts.Program {
  const files = [
    ...globSync("src/**/*.ts", { cwd: ROOT }),
    ...globSync("scripts/**/*.ts", { cwd: ROOT }),
  ].map(f => join(ROOT, f))

  return ts.createProgram(files, {
    strict: false,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    allowJs: false,
  })
}

// --- TS compiler API: extract property-access usage patterns ---

function extractUsages(typeName: string, program: ts.Program, _checker: ts.TypeChecker): string[] {
  const results: string[] = []

  function collectPropertyAccesses(scope: ts.Node, varName: string): string[] {
    const props: string[] = []
    function walk(node: ts.Node) {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === varName
      ) {
        props.push(node.name.text)
      }
      ts.forEachChild(node, walk)
    }
    walk(scope)
    return props
  }

  function getFunctionName(fn: ts.Node): string | null {
    if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) {
      const named = fn as ts.FunctionDeclaration | ts.MethodDeclaration
      return named.name && ts.isIdentifier(named.name) ? named.name.text : null
    }
    if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
      const parent = (fn as ts.ArrowFunction | ts.FunctionExpression).parent
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text
      }
    }
    return null
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue

    function visit(node: ts.Node) {
      if (
        (ts.isParameter(node) || ts.isVariableDeclaration(node)) &&
        node.type &&
        ts.isTypeReferenceNode(node.type) &&
        ts.isIdentifier(node.type.typeName) &&
        node.type.typeName.text === typeName &&
        node.parent &&
        ts.isIdentifier(node.name)
      ) {
        const varName = node.name.text
        const scope: ts.Node | undefined = ts.isParameter(node)
          ? (ts.isFunctionLike(node.parent)
              ? (node.parent as ts.FunctionLikeDeclaration).body ?? node.parent
              : node.parent)
          : node.parent?.parent

        if (scope) {
          for (const p of collectPropertyAccesses(scope, varName)) {
            results.push(`property "${p}" is accessed (via ${varName}: ${typeName})`)
          }
        }

        if (ts.isParameter(node) && ts.isFunctionLike(node.parent)) {
          const fnName = getFunctionName(node.parent)
          if (fnName) results.push(`passed as parameter "${varName}" to function "${fnName}"`)
        }
      }

      if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
        for (const clause of (node as ts.InterfaceDeclaration).heritageClauses ?? []) {
          for (const type of clause.types) {
            if (ts.isIdentifier(type.expression) && type.expression.text === typeName) {
              const name = (node as ts.InterfaceDeclaration | ts.ClassDeclaration).name?.text ?? "anonymous"
              results.push(`extended by "${name}"`)
            }
          }
        }
      }

      if (ts.isTypeAliasDeclaration(node) && ts.isIntersectionTypeNode(node.type)) {
        const refsTarget = node.type.types.some(
          t => ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && t.typeName.text === typeName,
        )
        if (refsTarget) results.push(`intersected into type "${node.name.text}"`)
      }

      if (
        ts.isAsExpression(node) &&
        ts.isTypeReferenceNode(node.type) &&
        ts.isIdentifier(node.type.typeName) &&
        node.type.typeName.text === typeName
      ) {
        results.push(`cast from external value using "as ${typeName}"`)
      }

      if (ts.isFunctionLike(node)) {
        const fn = node as ts.FunctionLikeDeclaration
        if (fn.type && ts.isTypeReferenceNode(fn.type) && ts.isIdentifier(fn.type.typeName) && fn.type.typeName.text === typeName) {
          const fnName = getFunctionName(node)
          results.push(fnName ? `returned from function "${fnName}"` : `used as return type`)
        }
      }

      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return [...new Set(results)]
}

// --- TS compiler API: extract spec functions for validation oracle ---
//
// Finds functions in *-usage-spec.ts files whose parameters reference typeName.
// These become the validation oracle: if [proposed type + spec code] compiles,
// the type has exactly what real code needs.

function extractSpecFunctions(typeName: string, program: ts.Program): string {
  const specFile = program.getSourceFiles().find(
    f => f.fileName.includes("usage-spec") || f.fileName.includes("-spec.ts"),
  )
  if (!specFile) return ""

  const parts: string[] = []

  // Only include functions where typeName appears in a PARAMETER type annotation.
  // Checking return types would pull in functions that *produce* this type but depend
  // on other types not yet defined (e.g. tryParse returns DCR but takes ParsePage).
  function hasTypeInParams(fn: ts.FunctionDeclaration): boolean {
    for (const param of fn.parameters) {
      if (!param.type) continue
      let found = false
      function check(n: ts.Node) {
        if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && n.typeName.text === typeName) {
          found = true
        }
        if (!found) ts.forEachChild(n, check)
      }
      check(param.type)
      if (found) return true
    }
    return false
  }

  ts.forEachChild(specFile, node => {
    if (ts.isFunctionDeclaration(node) && hasTypeInParams(node)) {
      parts.push(node.getText(specFile))
    }
  })

  return parts.join("\n\n")
}

// --- Latent scanner ---
//
// Scans for `type Foo = Alkahest` assignments. No prose, no JSDoc —
// the usage specs are the only source of truth.

function extractPinnedFields(src: string, name: string): string {
  const pattern = new RegExp(
    `export\\s+interface\\s+${name}\\s+extends\\s+(?:Volatile|Fluid|Salt)\\s*\\{([^}]*)\\}`,
    "s",
  )
  const m = pattern.exec(src)
  return m?.[1]?.trim() ?? ""
}

const PHASES = ["Volatile", "Fluid", "Salt"] as const
const PHASE_MAP: Record<string, Phase> = { Volatile: "volatile", Fluid: "fluid", Salt: "salt" }

function scanForTargets(): DecohereTarget[] {
  const files = globSync("src/**/*.ts", { cwd: ROOT })
  const raw: { name: string; kind: "type" | "interface"; phase: Phase; pinnedFields: string; sourceFile: string }[] = []

  for (const file of files) {
    const src = readFileSync(join(ROOT, file), "utf-8")

    // type Foo = Volatile|Fluid|Salt (total dissolution)
    const typePattern = /export\s+(type)\s+(\w+)\s*=\s*(Volatile|Fluid|Salt)\b/g
    let match
    while ((match = typePattern.exec(src)) !== null) {
      raw.push({ name: match[2], kind: "type", phase: PHASE_MAP[match[3]], pinnedFields: "", sourceFile: file })
    }

    // interface Foo extends Volatile|Fluid|Salt { ...pinned... } (partial dissolution)
    const ifacePattern = /export\s+(interface)\s+(\w+)\s+extends\s+(Volatile|Fluid|Salt)\b/g
    while ((match = ifacePattern.exec(src)) !== null) {
      const pinned = extractPinnedFields(src, match[2])
      raw.push({ name: match[2], kind: "interface", phase: PHASE_MAP[match[3]], pinnedFields: pinned, sourceFile: file })
    }
  }

  if (raw.length === 0) return []

  console.log("  building TS program for usage + spec extraction...")
  const program = buildProgram()
  const checker = program.getTypeChecker()

  const usageMap = new Map(raw.map(t => [t.name, extractUsages(t.name, program, checker)]))
  const specMap = new Map(raw.map(t => [t.name, extractSpecFunctions(t.name, program)]))

  const names = new Set(raw.map(t => t.name))

  const downstream = new Map<string, string[]>()
  for (const t of raw) {
    const allText = (usageMap.get(t.name) ?? []).join(" ")
    for (const name of names) {
      if (name !== t.name && allText.includes(name)) {
        if (!downstream.has(name)) downstream.set(name, [])
        downstream.get(name)!.push(`[downstream: ${t.name}] used together`)
      }
    }
  }

  const sorted = topoSort(raw.map(t => t.name), name => {
    return raw.filter(other => {
      if (other.name === name) return false
      const text = (usageMap.get(other.name) ?? []).join(" ")
      return text.includes(name)
    }).map(o => o.name)
  })

  return sorted.map(name => {
    const t = raw.find(r => r.name === name)!
    return {
      ...t,
      usages: usageMap.get(name) ?? [],
      specCode: specMap.get(name) ?? "",
      downstreamContexts: downstream.get(name) ?? [],
    }
  })
}

function topoSort(names: string[], getDependents: (name: string) => string[]): string[] {
  const depCount = new Map(names.map(n => [n, 0]))
  const dependentsOf = new Map(names.map(n => [n, [] as string[]]))

  for (const name of names) {
    for (const dep of getDependents(name)) {
      depCount.set(dep, (depCount.get(dep) ?? 0) + 1)
      dependentsOf.get(name)!.push(dep)
    }
  }

  const queue = names.filter(n => (depCount.get(n) ?? 0) === 0)
  const result: string[] = []

  while (queue.length > 0) {
    const node = queue.shift()!
    result.push(node)
    for (const dep of dependentsOf.get(node) ?? []) {
      const count = (depCount.get(dep) ?? 1) - 1
      depCount.set(dep, count)
      if (count === 0) queue.push(dep)
    }
  }

  for (const name of names) {
    if (!result.includes(name)) result.push(name)
  }

  return result
}

// --- Validation oracle ---
//
// Validates [prior types + proposed type + spec functions] together.
// The spec functions are the completeness check: if real usage code compiles,
// the type has exactly what it needs. Falls back to type-only if no spec.

function validateFull(
  typeName: string,
  proposed: string,
  prior: string[],
  specCode: string,
): { ok: boolean; error: string } {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true })

  const combined = [...prior, proposed, specCode].filter(Boolean).join("\n\n")
  const tempFile = join(TEMP_DIR, `${typeName}.ts`)
  writeFileSync(tempFile, combined)

  try {
    execSync(`npx tsc --noEmit --strict --target ES2022 --moduleResolution node ${tempFile}`, {
      cwd: ROOT,
      stdio: "pipe",
    })
    return { ok: true, error: "" }
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer; stdout?: Buffer }
    return {
      ok: false,
      error: (err.stderr?.toString() ?? err.stdout?.toString() ?? "unknown tsc error").slice(0, 800),
    }
  }
}

// --- Synthesis + repair loop ---
//
// Phase 1: synthesize from all facts at once (prose + usages + contexts).
// Phase 2: repair loop — if tsc rejects, feed back the error and retry.
//
// The loop uses the spec-code oracle: validation includes [prior + proposed + spec].
// If real usage code compiles against the proposed type, the type is complete.
//
// Parsimony comes from the minimize() pass after convergence, not from the loop.

function detectBaseType(usageText: string, candidates: string[]): string | null {
  for (const name of candidates) {
    if (usageText.includes(name)) return name
  }
  return null
}

function synthesizePrompt(target: DecohereTarget, baseType: string | null, prior: string[]): string {
  const { name, kind, usages, pinnedFields } = target
  const parts: string[] = []

  if (pinnedFields) {
    parts.push(`The following fields are pinned and MUST appear exactly as given:\n${pinnedFields}`)
  }

  if (usages.length > 0) {
    parts.push(`Usage patterns observed in the codebase:\n${usages.map(u => `- ${u}`).join("\n")}`)
  }

  if (target.specCode) {
    parts.push(`Usage spec (this code must compile against your type):\n${target.specCode}`)
  }

  if (baseType) {
    parts.push(`This type extends ${baseType}. Express it as:\ntype ${name} = ${baseType} & { ...only the additional fields... }`)
  }

  if (prior.length > 0) {
    parts.push(`Already defined:\n${prior.join("\n\n")}`)
  }

  return `Design a TypeScript ${kind} called "${name}".

${parts.join("\n\n")}

Infer the minimal type that satisfies all usage patterns and makes the spec compile.
Respond with ONLY the type definition. No explanation, no markdown fences.`
}

function repairPrompt(target: DecohereTarget, failed: string, error: string, baseType: string | null, prior: string[]): string {
  const baseHint = baseType
    ? `\nThis type extends ${baseType}. Use: type ${target.name} = ${baseType} & { ...extra fields... }`
    : ""
  return `This TypeScript definition failed to compile:

${failed}

TypeScript error:
${error}
${baseHint}
${prior.length ? `Already defined:\n${prior.join("\n\n")}\n` : ""}Fix it. Respond with ONLY the corrected definition.`
}

async function runDecohereOtter(
  target: DecohereTarget,
  prior: string[],
  combiner: Combiner,
  knownNames: string[],
  maxSteps: number,
): Promise<Item | null> {
  const allUsageText = target.usages.join(" ")
  const baseType = detectBaseType(allUsageText, knownNames.filter(n => n !== target.name))
  if (baseType) console.log(`  base type: ${baseType}`)
  if (target.specCode) console.log(`  oracle: spec functions active`)

  let currentPrompt = synthesizePrompt(target, baseType, prior)

  for (let step = 0; step < maxSteps; step++) {
    console.log(`  step ${step + 1}: generating...`)
    const proposed = await combiner(currentPrompt)
    const { ok, error } = validateFull(target.name, proposed, prior, target.specCode)

    if (ok) {
      console.log(`  ✓ valid on step ${step + 1}`)
      return makeItem(`proposal-${Date.now()}`, proposed)
    }

    console.log(`  · tsc rejected — queuing repair`)
    currentPrompt = repairPrompt(target, proposed, error, baseType, prior)
  }

  return null
}

// --- Minimize: remove fields not required by the validation oracle ---
//
// For each field in the winning type, try removing it. If the oracle still
// passes, the field was unnecessary (not grounded in evidence). What remains
// is parsimonious.

function minimize(
  target: DecohereTarget,
  winning: string,
  prior: string[],
): string {
  const fieldPattern = /^([ \t]+)(?:readonly[ \t]+)?(\w+)\??[ \t]*:.*$/gm
  const fields = [...winning.matchAll(fieldPattern)].map(m => m[2])

  if (fields.length === 0) return winning

  let current = winning
  let removedAny = false

  for (const field of fields) {
    const attempt = current
      .replace(new RegExp(`^[ \\t]+(?:readonly[ \\t]+)?${field}\\??[ \\t]*:[^\\n]*\\n?`, "m"), "")
      .replace(/\n{3,}/g, "\n\n")

    if (attempt === current) continue

    const { ok } = validateFull(target.name, attempt, prior, target.specCode)
    if (ok) {
      current = attempt
      removedAny = true
      console.log(`  ↓ removed unnecessary field "${field}"`)
    }
  }

  if (!removedAny) console.log(`  · already parsimonious`)
  return current
}

// --- Salt: in-place replacement ---
//
// Replaces the `interface Foo extends Salt { ...pinned... }` or `type Foo = Salt`
// in the original source file with the precipitated concrete type.
// The Salt import is consumed — it disappears from the file.

function applySalt(target: DecohereTarget, precipitate: string) {
  const filePath = join(ROOT, target.sourceFile)
  let src = readFileSync(filePath, "utf-8")

  // Replace the Salt declaration with the concrete type
  const ifacePattern = new RegExp(
    `export\\s+interface\\s+${target.name}\\s+extends\\s+Salt\\s*\\{[^}]*\\}`,
    "s",
  )
  const typePattern = new RegExp(
    `export\\s+type\\s+${target.name}\\s*=\\s*Salt\\b`,
  )

  if (ifacePattern.test(src)) {
    src = src.replace(ifacePattern, precipitate.replace(/^(type|interface)/, "export $1"))
  } else if (typePattern.test(src)) {
    src = src.replace(typePattern, precipitate.replace(/^(type|interface)/, "export $1"))
  }

  // Remove Salt from imports if no other Salt types remain
  if (!(/extends\s+Salt\b/.test(src) && src.includes(target.name) === false) &&
      !/=\s*Salt\b/.test(src.replace(precipitate, ""))) {
    // Remove Salt from the import line
    src = src.replace(/,\s*Salt\b/, "")
    src = src.replace(/\bSalt\s*,\s*/, "")
    // If Salt was the only import, remove the whole line
    src = src.replace(/import\s+type\s*\{\s*Salt\s*\}\s*from\s*["']alkahest-ts["']\s*\n?/, "")
  }

  writeFileSync(filePath, src)
}

// --- Fluid: check if re-precipitation needed ---

function fluidNeedsUpdate(target: DecohereTarget, prior: string[]): boolean {
  const outFile = join(GENERATED_DIR, `${target.name}.ts`)
  if (!existsSync(outFile)) return true

  const existing = readFileSync(outFile, "utf-8")
  const { ok } = validateFull(target.name, existing, prior, target.specCode)
  if (!ok) {
    console.log(`  ⚠ existing precipitate fails tsc — re-flowing`)
    return true
  }
  return false
}

// --- Main ---

async function main() {
  const targets = scanForTargets()

  if (targets.length === 0) {
    console.log("No targets found. Mark types with Volatile, Fluid, or Salt.")
    return
  }

  console.log(`\nFound ${targets.length} target(s):`)
  for (const t of targets) {
    const pins = t.pinnedFields ? `, ${t.pinnedFields.split("\n").length} pinned` : ""
    console.log(`  ${t.name} [${t.phase}]: ${t.usages.length} usage(s), spec: ${t.specCode ? "yes" : "no"}${pins}`)
  }

  const combiner = await resolveCombiner()
  mkdirSync(GENERATED_DIR, { recursive: true })

  const knownNames = targets.map(t => t.name)
  const prior: string[] = []

  for (const target of targets) {
    // Fluid: skip if existing precipitate still compiles
    if (target.phase === "fluid" && !fluidNeedsUpdate(target, prior)) {
      const existing = readFileSync(join(GENERATED_DIR, `${target.name}.ts`), "utf-8")
      prior.push(existing)
      console.log(`\n${target.name} [fluid]: still valid, skipping`)
      continue
    }

    console.log(`\nDecohering ${target.name} [${target.phase}]...`)

    const winner = await runDecohereOtter(target, prior, combiner, knownNames, 6)

    if (winner) {
      console.log(`  minimizing...`)
      const minimal = minimize(target, winner.content, prior)
      prior.push(minimal)

      if (target.phase === "salt") {
        // Salt: replace in-place, consume the marker
        applySalt(target, minimal)
        console.log(`  → ${target.sourceFile} (Salt consumed — type is now concrete)`)
      } else {
        // Volatile & Fluid: write to generated/
        const outFile = join(GENERATED_DIR, `${target.name}.ts`)
        writeFileSync(
          outFile,
          `// Precipitated by decohere [${target.phase}] — ${new Date().toISOString()}\n\n${minimal}\n`,
        )
        console.log(`  → src/generated/${target.name}.ts`)
      }
    } else {
      console.log(`  ✗ no valid proposal after max steps`)
    }
  }

  console.log("\nDone.")
}

main().catch(console.error)
