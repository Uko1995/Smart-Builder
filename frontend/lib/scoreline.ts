export type ScorelineBar = { score: string; probability: number };

export function topScorelines(matrix: unknown, limit = 8): ScorelineBar[] {
  if (!Array.isArray(matrix)) return [];
  const rows: ScorelineBar[] = [];
  matrix.forEach((row, home) => {
    if (!Array.isArray(row)) return;
    row.forEach((cell, away) => {
      const probability = typeof cell === "number" ? cell : Number(cell);
      if (!Number.isFinite(probability) || probability <= 0) return;
      rows.push({ score: `${home}-${away}`, probability });
    });
  });
  rows.sort((left, right) => right.probability - left.probability || left.score.localeCompare(right.score));
  return rows.slice(0, limit);
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
