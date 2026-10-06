/** Axial-force energy in two transverse Hermite planes. Tension is positive. */
export function initialStressGeometric(length: number, start: number, end: number): number[][] {
  const result = Array.from({ length: 12 }, () => Array<number>(12).fill(0));
  const points = [.5 - Math.sqrt(15) / 10, .5, .5 + Math.sqrt(15) / 10], weights = [5 / 18, 8 / 18, 5 / 18];
  for (const [point, t] of points.entries()) {
    const n = start * (1 - t) + end * t, slope = hermiteSlope(length, t);
    for (const [plane, indices] of [[1, 5, 7, 11], [2, 4, 8, 10]].entries()) for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const sign = (plane === 1 && r % 2 ? -1 : 1) * (plane === 1 && c % 2 ? -1 : 1);
      result[indices[r]][indices[c]] += n * length * weights[point] * slope[r] * slope[c] * sign;
    }
  }
  return result;
}
export function hermiteSlope(length: number, t: number) {
  return [(-6 * t + 6 * t * t) / length, 1 - 4 * t + 3 * t * t, (6 * t - 6 * t * t) / length, -2 * t + 3 * t * t];
}
