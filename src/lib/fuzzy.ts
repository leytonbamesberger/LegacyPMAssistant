/**
 * Type-ahead scoring: every whitespace-separated token of `query` must match
 * `text` (case-insensitive), either as a substring or as an in-order
 * subsequence ("alpt" finds "Alpha Tower"). Higher is better; null = no match.
 * Substrings beat subsequences, earlier beats later, and a match at the start
 * of a word beats one mid-word.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 0
  const haystack = text.toLowerCase()

  let total = 0
  for (const token of tokens) {
    const score = tokenScore(token, haystack)
    if (score === null) return null
    total += score
  }
  return total
}

function tokenScore(token: string, haystack: string): number | null {
  const at = haystack.indexOf(token)
  if (at !== -1) {
    const wordStart = at === 0 || /[^a-z0-9]/.test(haystack[at - 1])
    return 1000 - at + (wordStart ? 100 : 0)
  }

  // In-order subsequence; the tighter the match, the higher the score.
  let from = 0
  let first = -1
  let last = -1
  for (const ch of token) {
    const idx = haystack.indexOf(ch, from)
    if (idx === -1) return null
    if (first === -1) first = idx
    last = idx
    from = idx + 1
  }
  return 500 - (last - first - token.length) - first * 0.5
}
