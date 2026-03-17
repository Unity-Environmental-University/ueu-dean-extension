/**
 * Rhizome bridge — sends observations to the native messaging host,
 * which writes them as edges into the rhizome-alkahest graph.
 *
 * Silently no-ops if the native host isn't installed.
 */

const NATIVE_HOST = "com.ueu.dean"

export interface Observation {
  subject: string
  predicate: string
  object: string
  confidence?: number
  phase?: "volatile" | "fluid" | "salt"
  note?: string
}

async function send(msg: object): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, msg, (response) => {
        if (chrome.runtime.lastError) {
          // Native host not installed — silent, not an error for the dean
          resolve(null)
          return
        }
        resolve(response)
      })
    } catch {
      resolve(null)
    }
  })
}

export async function observe(obs: Observation): Promise<void> {
  await send({
    type: "observe",
    subject: obs.subject,
    predicate: obs.predicate,
    object: obs.object,
    confidence: obs.confidence ?? 0.7,
    phase: obs.phase ?? "fluid",
    note: obs.note ?? "",
  })
}

export async function query(subject: string): Promise<unknown[]> {
  const response = await send({ type: "query", subject }) as { ok: boolean; edges?: unknown[] } | null
  return response?.edges ?? []
}

export async function ping(): Promise<boolean> {
  const response = await send({ type: "ping" }) as { ok: boolean } | null
  return response?.ok === true
}
