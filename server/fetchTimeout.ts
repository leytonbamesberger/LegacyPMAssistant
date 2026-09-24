/**
 * Plain `fetch()` has no timeout — a stalled connection to Procore or
 * Anthropic hangs forever with no error, which is indistinguishable from a
 * frozen UI (this bit us during Submittal Checker spec sync development).
 * Every outbound call in `server/` should go through this instead.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request to ${input} timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
