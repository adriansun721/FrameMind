import type { MemberGeometry } from "./member-geometry";
import type { FrameUniformLoad, Vector3 } from "./project";

export function uniformLoadVector(load: FrameUniformLoad, geometry: MemberGeometry, coordinates: "global" | "local"): Vector3 {
  const q = load.intensity;
  if (load.coordinateSystem === coordinates) return { ...q };
  const axes = [geometry.localX, geometry.localY, geometry.localZ];
  if (coordinates === "local") {
    const values = axes.map((axis) => axis.x * q.x + axis.y * q.y + axis.z * q.z);
    return { x: values[0], y: values[1], z: values[2] };
  }
  return { x: axes[0].x * q.x + axes[1].x * q.y + axes[2].x * q.z, y: axes[0].y * q.x + axes[1].y * q.y + axes[2].y * q.z, z: axes[0].z * q.x + axes[1].z * q.y + axes[2].z * q.z };
}

export function memberUniformIntensity(loads: readonly FrameUniformLoad[], memberId: string, geometry: MemberGeometry): Vector3 {
  return loads.filter((load) => load.memberId === memberId).reduce((sum, load) => {
    const q = uniformLoadVector(load, geometry, "local");
    return { x: sum.x + q.x, y: sum.y + q.y, z: sum.z + q.z };
  }, { x: 0, y: 0, z: 0 });
}

export function uniformEquivalentForces(q: Vector3, length: number): number[] {
  const half = length / 2; const moment = length ** 2 / 12;
  return [q.x * half, q.y * half, q.z * half, 0, -q.z * moment, q.y * moment, q.x * half, q.y * half, q.z * half, 0, q.z * moment, -q.y * moment];
}
