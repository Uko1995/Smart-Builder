/**
 * Poisson scoreline grid with an optional Dixon-Coles adjustment.
 *
 * Dixon and Coles (1997) multiply the independent Poisson probabilities of
 * 0-0, 1-0, 0-1 and 1-1 by a dependence factor tau. Tau is not allowed to
 * become negative: rho is halved toward zero until every factor is positive.
 * Residual mass beyond MAX_GOALS is removed by normalising each marginal.
 */

export const MAX_GOALS = 12;
export const MAX_CORNERS = 20;

export type Matrix = number[][];

export function tau(homeGoals: number, awayGoals: number, lam: number, mu: number, rho: number): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lam * mu * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lam * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + mu * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

export function shrinkRho(lam: number, mu: number, rho: number): number {
  let current = rho;
  for (let step = 0; step < 24; step += 1) {
    const factors = [tau(0, 0, lam, mu, current), tau(0, 1, lam, mu, current), tau(1, 0, lam, mu, current), tau(1, 1, lam, mu, current)];
    if (Math.min(...factors) > 1e-9) return current;
    current *= 0.5;
  }
  return 0;
}

export function poissonPmf(rate: number, maxCount: number): number[] {
  const values = new Array<number>(maxCount + 1);
  values[0] = Math.exp(-rate);
  for (let k = 1; k <= maxCount; k += 1) values[k] = (values[k - 1] * rate) / k;
  return values;
}

export function marginalMass(rate: number, maxCount: number): number {
  return poissonPmf(rate, maxCount).reduce((sum, value) => sum + value, 0);
}

export function normalisedMarginal(rate: number, maxCount: number = MAX_GOALS): number[] {
  const values = poissonPmf(rate, maxCount);
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

export function scorelineMatrix(lambdaHome: number, lambdaAway: number, rho = 0, maxCount: number = MAX_GOALS): Matrix {
  if (lambdaHome <= 0 || lambdaAway <= 0) throw new Error("scoring rates must be positive");
  if (![lambdaHome, lambdaAway, rho].every(Number.isFinite)) throw new Error("scoring rates must be finite");
  const home = normalisedMarginal(lambdaHome, maxCount);
  const away = normalisedMarginal(lambdaAway, maxCount);
  const matrix: Matrix = home.map((h) => away.map((a) => h * a));
  const rhoUsed = shrinkRho(lambdaHome, lambdaAway, rho);
  if (rhoUsed !== 0) {
    for (const h of [0, 1]) {
      for (const a of [0, 1]) matrix[h][a] *= tau(h, a, lambdaHome, lambdaAway, rhoUsed);
    }
    const total = matrix.reduce((sum, row) => sum + row.reduce((inner, value) => inner + value, 0), 0);
    if (total <= 0) throw new Error("scoreline mass collapsed after the Dixon-Coles adjustment");
    for (const row of matrix) for (let index = 0; index < row.length; index += 1) row[index] /= total;
  }
  return matrix;
}

/** One cell of scorelineMatrix from its normalised marginals, without building the grid. */
export function scoreProbability(
  home: number[],
  away: number[],
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
  homeGoals: number,
  awayGoals: number,
): number {
  const cell = home[homeGoals] * away[awayGoals];
  const rhoUsed = shrinkRho(lambdaHome, lambdaAway, rho);
  if (rhoUsed === 0) return cell;
  let total = 1;
  for (const h of [0, 1]) {
    for (const a of [0, 1]) total += home[h] * away[a] * (tau(h, a, lambdaHome, lambdaAway, rhoUsed) - 1);
  }
  return (cell * tau(homeGoals, awayGoals, lambdaHome, lambdaAway, rhoUsed)) / total;
}

export function matrixSum(matrix: Matrix): number {
  return matrix.reduce((sum, row) => sum + row.reduce((inner, value) => inner + value, 0), 0);
}
