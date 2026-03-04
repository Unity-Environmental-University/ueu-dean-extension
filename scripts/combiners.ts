/**
 * Pluggable AI combiners for the decohere loop.
 *
 * A Combiner takes a prompt string and returns a completion string.
 * Swap them freely — the loop doesn't care which one you use.
 */

export type Combiner = (prompt: string) => Promise<string>

/**
 * Anthropic API combiner.
 * Requires ANTHROPIC_API_KEY env var.
 */
export async function makeAnthropicCombiner(model = "claude-haiku-4-5-20251001"): Promise<Combiner> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const client = new Anthropic()

  return async (prompt: string) => {
    const response = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    })
    return (response.content[0] as { text: string }).text.trim()
  }
}

/**
 * Local model combiner — talks to any HTTP server that accepts
 * POST { prompt: string } and returns { response: string }.
 *
 * Compatible with the local-model-experiment Flask server on :5051.
 * Also works with Ollama's /api/generate if you adapt the shape.
 */
export function makeLocalCombiner(baseUrl = "http://localhost:5051"): Combiner {
  return async (prompt: string) => {
    const res = await fetch(`${baseUrl}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    })

    if (!res.ok) throw new Error(`Local model error: ${res.status} ${res.statusText}`)

    const data = await res.json() as { response?: string; error?: string }
    if (data.error) throw new Error(`Local model error: ${data.error}`)
    if (!data.response) throw new Error("Local model returned no response")

    return data.response.trim()
  }
}

/**
 * OpenAI-compatible combiner — works with Ollama, LM Studio,
 * llama.cpp server, or anything that speaks the OpenAI chat API.
 *
 * e.g. makeOpenAICombiner("http://localhost:11434/v1", "qwen2.5:7b")
 */
export function makeOpenAICombiner(baseUrl: string, model: string): Combiner {
  return async (prompt: string) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
      }),
    })

    if (!res.ok) throw new Error(`OpenAI-compat error: ${res.status} ${res.statusText}`)

    const data = await res.json() as { choices: { message: { content: string } }[] }
    return data.choices[0].message.content.trim()
  }
}

/**
 * Resolve the combiner from environment / arguments.
 *
 * Priority:
 *   1. DECOHERE_MODEL=local       → local Flask server on :5051
 *   2. DECOHERE_MODEL=ollama:X    → Ollama with model X
 *   3. DECOHERE_MODEL=anthropic   → Anthropic API (default model)
 *   4. (default, no env var)      → local Flask server on :5051
 */
export async function resolveCombiner(): Promise<Combiner> {
  const setting = process.env.DECOHERE_MODEL ?? "local"

  if (setting === "local") {
    console.log("  combiner: local Flask server on :5051")
    return makeLocalCombiner()
  }

  if (setting.startsWith("ollama:")) {
    const model = setting.slice(7)
    console.log(`  combiner: Ollama (${model})`)
    return makeOpenAICombiner("http://localhost:11434/v1", model)
  }

  if (setting === "anthropic") {
    console.log("  combiner: Anthropic API")
    return makeAnthropicCombiner()
  }

  // Assume it's a full URL:model string like "http://localhost:1234/v1:qwen2.5-7b"
  const [url, model] = setting.split(":")
  console.log(`  combiner: OpenAI-compat at ${url} (${model})`)
  return makeOpenAICombiner(url, model)
}
