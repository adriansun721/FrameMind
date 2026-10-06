import type { Vector3 } from "./project";
import { GEOMETRY_CONTRACT } from "./geometry-policy";

export interface MemberGeometry { length: number; localX: Vector3; localY: Vector3; localZ: Vector3; referenceAxis: "global-z" | "global-y"; }
function cross(a: Vector3, b: Vector3): Vector3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function dot(a: Vector3, b: Vector3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function scale(v: Vector3, n: number): Vector3 { return { x: v.x * n, y: v.y * n, z: v.z * n }; }
function add(a: Vector3, b: Vector3): Vector3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function normalize(v: Vector3): Vector3 {
  const length = Math.hypot(v.x, v.y, v.z);
  if (!Number.isFinite(length) || length <= GEOMETRY_CONTRACT.memberLength.minimumExclusive) throw new Error("杆件长度必须大于零且超过 1e-12 m，不能超出有限数值范围");
  return scale(v, 1 / length);
}

export function calculateMemberGeometry(start: Vector3, end: Vector3, rotationDegrees: number): MemberGeometry {
  const delta = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (!Number.isFinite(length) || length <= GEOMETRY_CONTRACT.memberLength.minimumExclusive) throw new Error("杆件长度必须大于零且超过 1e-12 m，不能超出有限数值范围");
  if (!Number.isFinite(rotationDegrees)) throw new Error("截面转角必须是有限数值");
  const localX = normalize(delta); const globalZ = { x: 0, y: 0, z: 1 }; const globalY = { x: 0, y: 1, z: 0 };
  // Stabilize the reference choice across hypot/norm implementations at the boundary.
  const useGlobalZ = Math.abs(dot(localX, globalZ)) < 0.9 - 1e-12; const reference = useGlobalZ ? globalZ : globalY;
  const baseY = normalize(cross(reference, localX)); const baseZ = cross(localX, baseY); const angle = rotationDegrees * Math.PI / 180;
  const localY = add(scale(baseY, Math.cos(angle)), scale(baseZ, Math.sin(angle)));
  const localZ = add(scale(baseY, -Math.sin(angle)), scale(baseZ, Math.cos(angle)));
  return { length, localX, localY, localZ, referenceAxis: useGlobalZ ? "global-z" : "global-y" };
}
