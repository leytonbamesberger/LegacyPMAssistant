/** PostgREST silently truncates a response at the project's max-rows setting (1000 by default). */
const PAGE = 1000

interface RangeQuery<T> extends PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
  range(from: number, to: number): RangeQuery<T>
}

/**
 * Reads every row a query matches by walking `.range()` windows. Without this a
 * long-lived list (a PM's task history grows by a few rows per project per
 * month, forever) would quietly stop at 1000 rows. The query must be ordered by
 * something unique so windows don't overlap or skip.
 */
export async function selectAll<T>(build: () => RangeQuery<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE) return rows
  }
}
