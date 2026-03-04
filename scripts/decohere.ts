#!/usr/bin/env npx tsx
/**
 * decohere — alkahest-powered type design assistant.
 *
 * Finds @decohere-annotated types in src/, uses the Otter loop with
 * Claude as combineFn to propose TypeScript definitions, validates each
 * proposal with tsc, and writes passing proposals to src/generated/.
 *
 * Run: npm run decohere
 * Review output in src/generated/ and commit what you want to keep.
 *
 * Never runs on student data. Dev-time only.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { execSync } from "child_process"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { globSync } from "glob"
import Anthropic from "@anthropic-ai/sdk"
import { runOtter, makeItem } from "alkahest-ts"
import type { Item, OtterDomain, OtterState } from "alkahest-ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const GENERATED_DIR = join(ROOT, "src", "generated")
const TEMP_DIR = join(ROOT, ".decohere-tmp")

const client = new Anthropic()

// --- Annotation scanner ---

interface DecohereTarget {
  name: string
  kind: "type" | "interface"
  contexts: string[]
  raw: string
}

function scanForTargets(_dir: string): DecohereTarget[] {
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
      if (contexts.length === 0) continue  // need at least one constraint to work with

      targets.push({
        name: match[4],
        kind: match[3] as "type" | "interface",
        contexts,
        raw: comment,
      })
    }
  }

  return targets
}

// --- TSC validator ---

function validate(typeName: string, proposed: string, allProposed: string[]): boolean {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true })

  // Write all proposed types together so they can reference each other
  const combined = allProposed.join("\n\n") + "\n\n" + proposed
  const tempFile = join(TEMP_DIR, `${typeName}.ts`)
  writeFileSync(tempFile, combined)

  try {
    execSync(`npx tsc --noEmit --strict --target ES2022 --moduleResolution node ${tempFile}`, {
      cwd: ROOT,
      stdio: "pipe",
    })
    return true
  } catch {
    return false
  }
}

// --- Alkahest domain for type design ---

function makeDecohereDoamin(
  target: DecohereTarget,
  allProposed: string[],
): OtterDomain<Item> {
  const initialItems = target.contexts.map((ctx, i) =>
    makeItem(`context-${i}`, ctx)
  )

  const combineFn = async (a: Item, b: Item): Promise<Item[]> => {
    const prompt = `You are helping design a TypeScript type called "${target.name}".

Known facts about this type:
- ${a.content}
- ${b.content}

Propose a complete TypeScript ${target.kind} definition for "${target.name}".
Return ONLY the TypeScript code, no explanation, no markdown fences.
Use only primitive types, string, number, boolean, arrays, and references to these other types if needed: ${allProposed.map(p => p.split(" ")[2]).join(", ") || "none yet"}.`

    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    })

    const proposed = (response.content[0] as { text: string }).text.trim()
    return [makeItem(`proposal-${Date.now()}`, proposed)]
  }

  const stopFn = (state: OtterState<Item>): boolean => {
    const proposals = [...state.setOfSupport, ...state.usable]
      .filter(x => x.name.startsWith("proposal-"))

    return proposals.some(p => validate(target.name, p.content, allProposed))
  }

  return {
    initialState: (): OtterState<Item> => ({
      setOfSupport: initialItems,
      usable: [],
      history: [],
      step: 0,
      halted: false,
      haltReason: "",
    }),
    combineFn,
    stopFn,
  }
}

// --- Main ---

async function main() {
  const targets = scanForTargets(ROOT)

  if (targets.length === 0) {
    console.log("No @decohere targets found.")
    return
  }

  console.log(`Found ${targets.length} @decohere target(s): ${targets.map(t => t.name).join(", ")}\n`)
  mkdirSync(GENERATED_DIR, { recursive: true })

  const allProposed: string[] = []

  for (const target of targets) {
    console.log(`\nDecohering ${target.name}...`)

    const domain = makeDecohereDoamin(target, allProposed)
    const state = await runOtterAsync(domain, { maxSteps: 10, verbose: true })

    // Find the winning proposal
    const winner = [...state.setOfSupport, ...state.usable]
      .filter(x => x.name.startsWith("proposal-"))
      .find(p => validate(target.name, p.content, allProposed))

    if (winner) {
      allProposed.push(winner.content)
      const outFile = join(GENERATED_DIR, `${target.name}.ts`)
      writeFileSync(outFile, `// Generated by decohere — review before committing\n// ${new Date().toISOString()}\n\n${winner.content}\n`)
      console.log(`  ✓ ${target.name} → src/generated/${target.name}.ts`)
    } else {
      console.log(`  ✗ ${target.name}: no valid proposal found in ${10} steps`)
    }
  }

  console.log("\nDone. Review src/generated/ and commit what you want to keep.")
}

// runOtter is sync in alkahest-ts — we need an async wrapper for the LLM combineFn
async function runOtterAsync(
  domain: OtterDomain<Item>,
  options: { maxSteps: number; verbose: boolean },
): Promise<OtterState<Item>> {
  let state = domain.initialState()

  for (let i = 0; i < options.maxSteps; i++) {
    if (state.halted) break
    if (domain.stopFn?.(state)) {
      state = { ...state, halted: true, haltReason: "stop condition met" }
      break
    }

    if (state.setOfSupport.length === 0) {
      state = { ...state, halted: true, haltReason: "set_of_support empty" }
      break
    }

    const [focus, ...rest] = state.setOfSupport
    state = { ...state, setOfSupport: rest, step: state.step + 1 }

    if (options.verbose) console.log(`  step ${state.step}: focus = "${focus.content.slice(0, 60)}..."`)

    const newItems: Item[] = []
    for (const y of state.usable) {
      const results = await domain.combineFn(focus, y)
      for (const r of results) {
        if (![...state.setOfSupport, ...state.usable, ...newItems].some(x => x.name === r.name)) {
          newItems.push({ ...r, step: state.step })
        }
      }
    }

    state = {
      ...state,
      usable: [...state.usable, focus],
      setOfSupport: [...state.setOfSupport, ...newItems],
    }
  }

  return state
}

main().catch(console.error)
