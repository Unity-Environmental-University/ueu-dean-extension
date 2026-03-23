/** Shared formatting helpers for view components. */

export function scoreColor(score: number | null): string {
  if (score === null) return "#888"
  if (score >= 90) return "#16a34a"
  if (score >= 80) return "#65a30d"
  if (score >= 70) return "#ca8a04"
  if (score >= 60) return "#ea580c"
  return "#dc2626"
}

export function formatScore(score: number | null): string {
  if (score === null) return "—"
  return score.toFixed(1) + "%"
}

export function formatLda(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}
