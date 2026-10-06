/** Absolute product sums retain the scale lost by cancellation in HᵀKH or TᵀKcT. */
function congruenceMagnitude(stiffness: number[][], transformation: number[][]): number[][] {
  return stiffness.map((_, i) => stiffness.map((_, j) => stiffness.reduce((sum, row, a) =>
    sum + row.reduce((subtotal, value, b) => subtotal + Math.abs(transformation[a][i] * value * transformation[b][j]), 0), 0)));
}

export function releaseCoefficientMagnitudes(coefficients: {
  originalLocalStiffness: number[][]; recoveryTransformation: number[][]; transformation: number[][];
}) {
  const local = congruenceMagnitude(coefficients.originalLocalStiffness, coefficients.recoveryTransformation);
  return { local, global: congruenceMagnitude(local, coefficients.transformation) };
}

export function coefficientNumbersMatch(actual: number[], reference: number[], cancellationMagnitude?: number[]): boolean {
  return actual.length === reference.length && actual.every((value, index) => Math.abs(value - reference[index]) <= Math.max(
    1e-9 * Math.max(1, Math.abs(reference[index])),
    // 12-term products and two transformations, with independent elimination orders.
    128 * Number.EPSILON * (cancellationMagnitude?.[index] ?? 0)));
}
