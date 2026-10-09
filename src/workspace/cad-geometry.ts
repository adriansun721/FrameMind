import type { CadBounds, CadPose } from "../../electron/contracts";
export type { CadVector, CadBounds, CadCenterline, CadEngineeringGeometry, CadPose, CadPoseDecision } from "../../electron/contracts";
export const CAD_ORIGINAL_POSE: CadPose = { translationM: [0, 0, 0], rotationDegrees: [0, 0, 0] };
/** Right handed global rotations X, then Y, then Z about the original origin; translation last. */
export function transformCadPoint(p: number[], pose: CadPose): number[] {
  if (p.length !== 3 || [...p, ...pose.translationM, ...pose.rotationDegrees].some((n) => !Number.isFinite(n))) throw new Error("位姿与坐标必须是有限数值");
  let [x, y, z] = p;
  for (let axis = 0; axis < 3; axis++) {
    const angle = pose.rotationDegrees[axis] * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    if (axis === 0) [y, z] = [c * y - s * z, s * y + c * z];
    if (axis === 1) [x, z] = [c * x + s * z, -s * x + c * z];
    if (axis === 2) [x, y] = [c * x - s * y, s * x + c * y];
  }
  return [x, y, z].map((v, i) => Math.round((v + pose.translationM[i]) * 1e12) / 1e12);
}
export function cadBounds(points: number[][]): CadBounds | null {
  if (!points.length) return null;
  return { min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))), max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))) };
}
export function cadBoundsCorners(bounds: CadBounds): number[][] {
  return [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => [bounds[x ? "max" : "min"][0], bounds[y ? "max" : "min"][1], bounds[z ? "max" : "min"][2]])));
}
