/**
 * load-canvas-messages.ts — Canvas conversations loader.
 *
 * Probes masquerade permission and fetches conversations between
 * a student and an optional instructor (or the student's full inbox).
 * Pure async with injected deps — never touches state directly.
 */

export interface CanvasConversationMessage {
  id: number
  created_at: string
  body: string
  author_id: number
  generated: boolean
}

export interface CanvasConversation {
  id: number
  subject: string
  last_message_at: string
  message_count: number
  participants: Array<{ id: number; name: string; full_name?: string }>
  messages: CanvasConversationMessage[]
}

export interface LoadMessagesDeps {
  canvasFetch: <T>(path: string) => Promise<T>
  isStale: () => boolean
}

/**
 * Fetch Canvas conversations for a student, optionally filtered to a specific instructor.
 * Masquerades as the student to retrieve their inbox.
 * Returns up to 5 conversations with full message bodies.
 */
export async function loadCanvasConversations(
  studentCanvasId: string,
  instructorCanvasId: string | null,
  deps: LoadMessagesDeps,
): Promise<{ conversations: CanvasConversation[]; error: string | null }> {
  try {
    let path = `/api/v1/conversations?as_user_id=${studentCanvasId}&per_page=20`
    if (instructorCanvasId) path += `&filter[]=user_${instructorCanvasId}`

    const list = await deps.canvasFetch<Array<{
      id: number
      subject: string
      last_message_at: string
      message_count: number
      participants: Array<{ id: number; name: string; full_name?: string }>
    }>>(path)

    if (deps.isStale()) return { conversations: [], error: null }

    // Fetch full messages for up to 5 conversations
    const conversations: CanvasConversation[] = []
    for (const item of list.slice(0, 5)) {
      if (deps.isStale()) break
      try {
        const detail = await deps.canvasFetch<CanvasConversation>(
          `/api/v1/conversations/${item.id}?as_user_id=${studentCanvasId}`
        )
        conversations.push(detail)
      } catch {
        // Fallback: include conversation without messages
        conversations.push({ ...item, messages: [] })
      }
    }

    return { conversations, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("401") || msg.includes("403")) {
      return { conversations: [], error: "no-permission" }
    }
    return { conversations: [], error: msg }
  }
}
