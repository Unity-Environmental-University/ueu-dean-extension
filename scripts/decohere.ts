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
import { makeItem } from "alkahest-ts"
import type { Item, OtterDomain, OtterState } from "alkahest-ts"
import { resolveCombiner, type Combiner } from "./combiners.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const GENERATED_DIR = join(ROOT, "src", "generated")
const TEMP_DIR = join(ROOT, ".decohere-tmp")

// --- Annotation scanner ---

interface DecohereTarget {
  name: string
  kind: "type" | "interface"
  contexts: string[]
}

function scanForTargets(): DecohereTarget[] {
  const files = globSync("src/**/*.ts", { cwd: ROOT })
  const targets: DecohereTarget[] = []

  for (const file of files) {
    const src = readFileSync(join(ROOT, file), "utf-8")
    const pattern = /\/\*\*([\s\S]*?)\*\/([\s\S]*?)export\s+(type|interface)\s+(\w+)/g
    let match

    while ((match = pattern.exec(src)) !== null) {
      const comment = match[1]
      if (!comment.includes("@decohere")) continue
      const contexts = [...comment.matchAll(/@context (.+)/g)].map(m => m[1].trim())
      if (contexts.length === 0) continue

      targets.push({ name: match[4], kind: match[3] as "type" | "interface", contexts })
    }
  }

  return targets
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
  return `You are designing a TypeScript ${target.kind} called "${target.name}".

Constraints:
${target.contexts.map(c => `- ${c}`).join("\n")}
${prior.length ? `\nAlready defined types you may reference:\n${prior.join("\n\n")}` : ""}

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
//
// Items are proposals. The loop:
//   Step 0: "synthesize" item moves to usable, seeds the first real proposal
//   Step 1+: focus = latest proposal, usable includes prior attempts + errors
//            combineFn generates a repair
//   stopFn: tsc passes
//
// This gives us 1 AI call for synthesis + N repair calls only if needed.

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
      // focus.content is either a prompt (synthesize) or a failed proposal + error
      const result = await combiner(focus.content)
      return [makeItem(`proposal-${Date.now()}`, result)]
    },

    stopFn: (state: OtterState<Item>): boolean => {
      const proposals = [...state.setOfSupport, ...state.usable]
        .filter(x => x.name.startsWith("proposal-"))
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

    // Generate a proposal from the focus prompt
    console.log(`  call ${state.step}: generating proposal...`)
    const proposed = await combiner(focus.content)
    const item = makeItem(`proposal-${Date.now()}`, proposed)

    const { ok, error } = validate(target.name, proposed, prior)

    if (ok) {
      console.log(`  ✓ valid on call ${state.step}`)
      return item
    }

    console.log(`  ✗ tsc rejected — queuing repair`)

    // Seed next iteration with a repair prompt
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
