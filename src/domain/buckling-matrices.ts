import { getFrozenMemberCoefficients, type AnalysisInputSnapshot } from "./analysis";
import type { BucklingRecord } from "./buckling";

/** Verify small captured matrices from frozen coefficients and verified prestress.
 * This assembles coefficients only; it never solves or replaces captured work. */
export function validateBucklingMatrixCorrespondence(input: AnalysisInputSnapshot, record: BucklingRecord): void {
  const problem = record.eigenproblem, count = record.counts.equations;
  if (count > problem.matrixLimit) return;
  const keys = new Map(problem.coordinates.map((c, i) => [`${c.kind}:${c.id}:${c.dof}`, i]));
  const expected = Array.from({ length: 3 }, () => Array.from({ length: count }, () => Array<number>(count).fill(0)));
  const magnitude = structuredClone(expected);
  const calculation = record.preloadRuns.reference.input;
  for (const [elementIndex, member] of calculation.members.entries()) {
    const coefficients = getFrozenMemberCoefficients(calculation, member.id), prestress = record.prestress[elementIndex];
    const geometry = calculation.calculationFrames![member.id], axes = [geometry.localX, geometry.localY, geometry.localZ];
    const map = Array.from({ length: 12 }, (_, local): Array<[number, number]> => {
      const end = local < 6 ? "start" : "end", dof = local % 6, nodeId = end === "start" ? member.startNodeId : member.endNodeId;
      const release = dof === 4 ? member.endReleases?.[end].my : dof === 5 ? member.endReleases?.[end].mz : false;
      if (release) return [[keys.get(`release:${member.id}:${end}.${dof === 4 ? "my" : "mz"}`)!, 1]];
      const axis = axes[dof % 3];
      return (["x", "y", "z"] as const).flatMap((key, i) => {
        const index = keys.get(`node:${nodeId}:${input.dofOrder[(dof >= 3 ? 3 : 0) + i]}`);
        return index === undefined || axis[key] === 0 ? [] : [[index, axis[key]] as [number, number]];
      });
    });
    const geometric = (start: number, end: number) => {
      const matrix = Array.from({ length: 12 }, () => Array<number>(12).fill(0));
      const l = geometry.length, points = [.5 - Math.sqrt(15) / 10, .5, .5 + Math.sqrt(15) / 10], weights = [5 / 18, 8 / 18, 5 / 18];
      for (const [point, t] of points.entries()) {
        const n = start * (1 - t) + end * t, slope = [(-6 * t + 6 * t * t) / l, 1 - 4 * t + 3 * t * t, (6 * t - 6 * t * t) / l, -2 * t + 3 * t * t];
        for (const [plane, indices] of [[1, 5, 7, 11], [2, 4, 8, 10]].entries()) for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
          const sign = (plane === 1 && r % 2 ? -1 : 1) * (plane === 1 && c % 2 ? -1 : 1);
          matrix[indices[r]][indices[c]] += n * l * weights[point] * slope[r] * slope[c] * sign;
        }
      }
      return matrix;
    };
    const localMatrices = [coefficients.originalLocalStiffness, geometric(prestress.fixedAxialStartKN, prestress.fixedAxialEndKN), geometric(prestress.referenceAxialStartKN, prestress.referenceAxialEndKN)];
    for (const [m, local] of localMatrices.entries()) for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
      for (const [row, a] of map[r]) for (const [column, b] of map[c]) {
        const value = a * local[r][c] * b;
        expected[m][row][column] += value; magnitude[m][row][column] += Math.abs(value);
      }
    }
  }
  for (const [m, captured] of [problem.stiffness, problem.fixedGeometric, problem.referenceGeometric].entries()) {
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (!Number.isFinite(expected[m][r][c]) || !Number.isFinite(magnitude[m][r][c]) || Math.abs(captured![r][c] - expected[m][r][c]) > 1e-9 * Math.max(1, magnitude[m][r][c])) throw new Error("屈曲实际矩阵与冻结弹性系数／预应力不对应");
  }
}
