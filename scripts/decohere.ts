#!/usr/bin/env npx tsx
/**
 * decohere — alkahest-powered type design assistant.
 *
 * Finds @decohere-annotated types in src/, proposes TypeScript definitions
 * using a local or remote AI model, validates with tsc, and writes passing
 * proposals to src/generated/ for human review.
 *
 * Run: npm run decohere
 * Set DECOHERE_MODEL to control the AI backend (default: local)
 *
 * Constraint sources (no @context lines required):
 *   1. JSDoc prose on the type (non-tag lines)
 *   2. TS compiler API — property accesses, function signatures, extends
 *   3. @context lines still accepted as explicit overrides
 *
 * Call strategy: one synthesis call per type, then repair-loop with tsc
 * error feedback. Best case: 1 AI call per type.
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
import type { Item, OtterDomain, OtterState } from "alkahest-ts"
import { resolveCombiner, type Combiner } from "./combiners.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const GENERATED_DIR = join(ROOT, "src", "generated")
const TEMP_DIR = join(ROOT, ".decohere-tmp")

// --- Annotation scanner + dependency graph ---

interface DecohereTarget {
  name: string
  kind: "type" | "interface"
  prose: string        // JSDoc text (non-tag lines), the type's documentation
  contexts: string[]   // explicit @context hints (optional, legacy)
  usages: string[]     // inferred from TS compiler API
  downstreamContexts: string[]  // from types that reference/extend this one
}

// --- TS compiler API: build program for usage extraction ---
//
// We include src/ AND scripts/ to pick up usage specs and other non-app TS.
// We use loose options — we want the AST, not strict type correctness.

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

// --- TS compiler API: extract usage patterns for a type ---

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
      // Parameter or variable declared as TypeName
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

        // Find the scope: function body for params, parent block for vars
        const scope: ts.Node | undefined = ts.isParameter(node)
          ? (ts.isFunctionLike(node.parent)
              ? (node.parent as ts.FunctionLikeDeclaration).body ?? node.parent
              : node.parent)
          : node.parent?.parent

        if (scope) {
          const props = collectPropertyAccesses(scope, varName)
          for (const p of props) {
            results.push(`property "${p}" is accessed (via ${varName}: ${typeName})`)
          }
        }

        if (ts.isParameter(node) && ts.isFunctionLike(node.parent)) {
          const fnName = getFunctionName(node.parent)
          if (fnName) {
            results.push(`passed as parameter "${varName}" to function "${fnName}"`)
          }
        }
      }

      // interface/class: extends TypeName
      if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
        for (const clause of (node as ts.InterfaceDeclaration).heritageClauses ?? []) {
          for (const type of clause.types) {
            if (ts.isIdentifier(type.expression) && type.expression.text === typeName) {
              const declNode = node as ts.InterfaceDeclaration | ts.ClassDeclaration
              const name = declNode.name?.text ?? "anonymous"
              results.push(`extended by "${name}"`)
            }
          }
        }
      }

      // type alias: type Foo = TypeName & { ... }
      if (ts.isTypeAliasDeclaration(node) && ts.isIntersectionTypeNode(node.type)) {
        const refsTarget = node.type.types.some(
          t =>
            ts.isTypeReferenceNode(t) &&
            ts.isIdentifier(t.typeName) &&
            t.typeName.text === typeName,
        )
        if (refsTarget) {
          results.push(`intersected into type "${node.name.text}"`)
        }
      }

      // value as TypeName
      if (
        ts.isAsExpression(node) &&
        ts.isTypeReferenceNode(node.type) &&
        ts.isIdentifier(node.type.typeName) &&
        node.type.typeName.text === typeName
      ) {
        results.push(`cast from external value using "as ${typeName}"`)
      }

      // function(): TypeName (return type annotation)
      if (ts.isFunctionLike(node)) {
        const fn = node as ts.FunctionLikeDeclaration
        if (
          fn.type &&
          ts.isTypeReferenceNode(fn.type) &&
          ts.isIdentifier(fn.type.typeName) &&
          fn.type.typeName.text === typeName
        ) {
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

// --- Annotation scanner ---

function extractProse(comment: string): string {
  return comment
    .split("\n")
    .map(l => l.replace(/^\s*\*?\s*/, "").trim())
    .filter(l => l.length > 0 && !l.startsWith("@"))
    .join(" ")
}

function scanForTargets(): DecohereTarget[] {
  const files = globSync("src/**/*.ts", { cwd: ROOT })
  const raw: Omit<DecohereTarget, "downstreamContexts" | "usages">[] = []

  for (const file of files) {
    const src = readFileSync(join(ROOT, file), "utf-8")
    // (?:[^*]|\*[^/])* matches JSDoc content without spanning past the first */
    const pattern = /\/\*\*((?:[^*]|\*[^/])*)\*\/\s*export\s+(type|interface)\s+(\w+)/g
    let match

    while ((match = pattern.exec(src)) !== null) {
      const comment = match[1]
      if (!comment.includes("@decohere")) continue
      const prose = extractProse(comment)
      const contexts = [...comment.matchAll(/@context (.+)/g)].map(m => m[1].trim())
      raw.push({ name: match[3], kind: match[2] as "type" | "interface", prose, contexts })
    }
  }

  if (raw.length === 0) return []

  console.log("  building TS program for usage extraction...")
  const program = buildProgram()
  // getTypeChecker() triggers binding, which sets parent pointers on all AST nodes
  const checker = program.getTypeChecker()
  const usageMap = new Map(raw.map(t => [t.name, extractUsages(t.name, program, checker)]))

  const names = new Set(raw.map(t => t.name))

  // Infer downstream relationships: if type B's text mentions type A, A is a dependency of B
  const downstream = new Map<string, string[]>()
  for (const t of raw) {
    const allText = [t.prose, ...t.contexts, ...(usageMap.get(t.name) ?? [])].join(" ")
    for (const name of names) {
      if (name !== t.name && allText.includes(name)) {
        if (!downstream.has(name)) downstream.set(name, [])
        downstream.get(name)!.push(`[downstream: ${t.name}] ${t.prose.slice(0, 120)}`)
      }
    }
  }

  // Topological sort: dependencies (referenced types) before dependents
  // topoSort expects getDependents(name) = "who depends on me" (downstream consumers).
  // CaseRecord → DishonestyCaseRecord → ParsePage
  const sorted = topoSort(raw.map(t => t.name), name => {
    return raw.filter(other => {
      if (other.name === name) return false
      // Does `other` mention `name` in its prose/context/usages? If so, other depends on name.
      const text = [other.prose, ...other.contexts, ...(usageMap.get(other.name) ?? [])].join(" ")
      return text.includes(name)
    }).map(o => o.name)
  })

  return sorted.map(name => {
    const t = raw.find(r => r.name === name)!
    return { ...t, usages: usageMap.get(name) ?? [], downstreamContexts: downstream.get(name) ?? [] }
  })
}

function topoSort(names: string[], getDeps: (name: string) => string[]): string[] {
  // Kahn's algorithm — dependencies (roots) go first
  const depCount = new Map(names.map(n => [n, 0]))
  const dependentsOf = new Map(names.map(n => [n, [] as string[]]))

  for (const name of names) {
    for (const dep of getDeps(name)) {
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

// --- TSC validator ---

function validate(typeName: string, proposed: string, prior: string[]): { ok: boolean; error: string } {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true })

  const combined = [...prior, proposed].join("\n\n")
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

// --- Prompts ---

function synthesizePrompt(target: DecohereTarget, prior: string[]): string {
  const parts: string[] = []

  if (target.prose) {
    parts.push(`Documentation:\n${target.prose}`)
  }

  if (target.contexts.length > 0) {
    parts.push(`Explicit constraints:\n${target.contexts.map(c => `- ${c}`).join("\n")}`)
  }

  if (target.usages.length > 0) {
    parts.push(`Usage patterns inferred from the codebase:\n${target.usages.map(u => `- ${u}`).join("\n")}`)
  } else {
    parts.push(`(No usage patterns found in codebase — infer shape from documentation and type name.)`)
  }

  if (target.downstreamContexts.length > 0) {
    parts.push(
      `Downstream requirements (types that extend or use this one):\n${target.downstreamContexts.map(c => `- ${c}`).join("\n")}`,
    )
  }

  if (prior.length > 0) {
    parts.push(`Already defined types you may reference:\n${prior.join("\n\n")}`)
  }

  return `You are designing a TypeScript ${target.kind} called "${target.name}".

${parts.join("\n\n")}

Respond with ONLY a valid TypeScript ${target.kind} definition. No explanation, no markdown fences.`
}

function repairPrompt(target: DecohereTarget, failed: string, error: string, prior: string[]): string {
  return `This TypeScript ${target.kind} definition failed to compile:

${failed}

TypeScript error:
${error}

${prior.length ? `Other types already defined:\n${prior.join("\n\n")}\n\n` : ""}Fix it. Respond with ONLY the corrected definition. No explanation, no markdown fences.`
}

// --- Alkahest domain ---

function makeDecohereDomain(
  target: DecohereTarget,
  prior: string[],
  combiner: Combiner,
): OtterDomain<Item> {
  return {
    initialState: (): OtterState<Item> => ({
      setOfSupport: [makeItem("synthesize", synthesizePrompt(target, prior))],
      usable: [],
      history: [],
      step: 0,
      halted: false,
      haltReason: "",
    }),

    combineFn: async (focus: Item, _other: Item): Promise<Item[]> => {
      const result = await combiner(focus.content)
      return [makeItem(`proposal-${Date.now()}`, result)]
    },

    stopFn: (state: OtterState<Item>): boolean => {
      const proposals = [...state.setOfSupport, ...state.usable].filter(x =>
        x.name.startsWith("proposal-"),
      )
      return proposals.some(p => validate(target.name, p.content, prior).ok)
    },
  }
}

// --- Async otter loop ---

async function runOtterAsync(
  domain: OtterDomain<Item>,
  target: DecohereTarget,
  prior: string[],
  combiner: Combiner,
  maxSteps: number,
): Promise<Item | null> {
  let state = domain.initialState()

  for (let i = 0; i < maxSteps; i++) {
    if (state.setOfSupport.length === 0) break

    const [focus, ...rest] = state.setOfSupport
    state = { ...state, setOfSupport: rest, step: state.step + 1 }

    console.log(`  call ${state.step}: generating proposal...`)
    const proposed = await combiner(focus.content)
    const item = makeItem(`proposal-${Date.now()}`, proposed)

    const { ok, error } = validate(target.name, proposed, prior)

    if (ok) {
      console.log(`  ✓ valid on call ${state.step}`)
      return item
    }

    console.log(`  ✗ tsc rejected — queuing repair`)

    const repairItem = makeItem(
      `repair-${Date.now()}`,
      repairPrompt(target, proposed, error, prior),
    )

    state = {
      ...state,
      usable: [...state.usable, focus],
      setOfSupport: [...state.setOfSupport, repairItem],
    }
  }

  return null
}

// --- Main ---

async function main() {
  const targets = scanForTargets()

  if (targets.length === 0) {
    console.log("No @decohere targets found.")
    return
  }

  console.log(`Found ${targets.length} target(s): ${targets.map(t => t.name).join(", ")}`)

  for (const t of targets) {
    const usageNote = t.usages.length > 0
      ? `${t.usages.length} usage pattern(s) found`
      : "no usage patterns — using prose + name"
    console.log(`  ${t.name}: ${usageNote}`)
  }

  const combiner = await resolveCombiner()
  mkdirSync(GENERATED_DIR, { recursive: true })

  const prior: string[] = []

  for (const target of targets) {
    console.log(`\nDecohering ${target.name}...`)

    const domain = makeDecohereDomain(target, prior, combiner)
    const winner = await runOtterAsync(domain, target, prior, combiner, 5)

    if (winner) {
      prior.push(winner.content)
      const outFile = join(GENERATED_DIR, `${target.name}.ts`)
      writeFileSync(
        outFile,
        `// Generated by decohere — review before committing\n// ${new Date().toISOString()}\n\n${winner.content}\n`,
      )
      console.log(`  → src/generated/${target.name}.ts`)
    } else {
      console.log(`  ✗ no valid proposal after 5 attempts`)
    }
  }

  console.log("\nDone. Review src/generated/ and commit what you want to keep.")
}

main().catch(console.error)
