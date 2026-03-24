/** Canvas instance hostname — all Canvas API calls and links use this. */
export const CANVAS_HOST = "unity.instructure.com"

/** Full Canvas base URL for building links. */
export const CANVAS_URL = `https://${CANVAS_HOST}`

/** Detect Canvas 401 errors from error messages. Normalizes three prior detection variants. */
export function isCanvasAuthError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("401")
}
