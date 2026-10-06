import { calculateMemberGeometry } from "./member-geometry";
import type { FrameMember } from "./project";
import { NATIVE_RELEASE_STATIC_SOLVER, sameInputValue, type AnalysisInputSnapshot, type AnalysisProcessSnapshot, type NativeReleaseRecovery } from "./analysis";

/** Validate captured numerical work before it enters persistence, process views or reports. */
export function decodeNativeReleaseRecovery(value: unknown, member: FrameMember, ends: number[]): NativeReleaseRecovery {
  if (!value || typeof value !== "object") throw new Error("释放杆件缺少原生恢复记录");
  const input = value as Record<string, unknown>;
  const vector = (key: string): number[] => {
    const v = input[key];
    if (!Array.isArray(v) || v.length !== 12 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error("原生释放恢复向量无效");
    return [...v];
  };
  const matrix = (key: string): number[][] => {
    const m = input[key];
    if (!Array.isArray(m) || m.length !== 12 || m.some((row) => !Array.isArray(row) || row.length !== 12 || !row.every((n) => typeof n === "number" && Number.isFinite(n)))) throw new Error("原生释放恢复矩阵无效");
    return m.map((row) => [...row]);
  };
  const r: NativeReleaseRecovery = { originalLocalStiffness: matrix("originalLocalStiffness"), localStiffness: matrix("localStiffness"),
    transformation: matrix("transformation"), recoveryTransformation: matrix("recoveryTransformation"), globalStiffness: matrix("globalStiffness"),
    localDisplacement: vector("localDisplacement"), originalEquivalentLocalForces: vector("originalEquivalentLocalForces"),
    equivalentLocalForces: vector("equivalentLocalForces"), equivalentGlobalForces: vector("equivalentGlobalForces") };
  const tolerance = Math.max(1e-9, ...ends.map((v) => Math.abs(v) * 1e-10));
  for (let i = 0; i < 12; i++) {
    const recovered = r.originalLocalStiffness[i].reduce((sum, k, j) => sum + k * r.localDisplacement[j], 0) - r.originalEquivalentLocalForces[i];
    if (Math.abs(recovered - ends[i]) > tolerance) throw new Error("原生释放恢复记录与杆端力不一致");
    if (i % 6 === 4 || i % 6 === 5) {
      const end = i < 6 ? member.endReleases?.start : member.endReleases?.end;
      if (end?.[i % 6 === 4 ? "my" : "mz"] && (Math.abs(ends[i]) > tolerance || r.localStiffness[i].some((v) => v !== 0))) throw new Error("释放端弯矩或凝聚刚度无效");
    }
  }
  return r;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function decodeReleaseGauges(value: Record<string, unknown>, input: AnalysisInputSnapshot, loadVector: number[]) {
  const indices = (items: unknown) => {
    if (!Array.isArray(items) || !items.every((index) => Number.isSafeInteger(index) && index >= 0 && index < input.nodes.length * 6)) throw new Error("Invalid release gauge indices");
    return [...items] as number[];
  };
  const releaseGaugeDofs = value.releaseGaugeDofs === undefined ? [] : indices(value.releaseGaugeDofs);
  const releaseNullRotations: NonNullable<AnalysisProcessSnapshot["releaseNullRotations"]> = [];
  if (releaseGaugeDofs.length) {
    if (!sameInputValue(input.solver, NATIVE_RELEASE_STATIC_SOLVER) || !Array.isArray(value.releaseNullRotations) || value.releaseNullRotations.length !== releaseGaugeDofs.length || new Set(releaseGaugeDofs).size !== releaseGaugeDofs.length) throw new Error("Invalid release null rotations");
    const previous: number[] = [];
    for (const record of value.releaseNullRotations) {
      if (!isRecord(record) || !isRecord(record.direction) || typeof record.nodeId !== "string" || typeof record.gaugeDof !== "number" || !releaseGaugeDofs.includes(record.gaugeDof)) throw new Error("Invalid release gauge mapping");
      const n = input.nodes.findIndex((node) => node.id === record.nodeId), d = record.direction;
      if (n < 0 || record.gaugeDof < n * 6 + 3 || record.gaugeDof > n * 6 + 5 || ![d.x, d.y, d.z].every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error("Invalid released rotation direction");
      const direction = { x: d.x as number, y: d.y as number, z: d.z as number };
      const components = [direction.x, direction.y, direction.z];
      const dot = (axis: typeof direction) => axis.x * direction.x + axis.y * direction.y + axis.z * direction.z;
      if (Math.abs(Math.hypot(...components) - 1) > 1e-9 || Math.abs(components[record.gaugeDof % 6 - 3]) < 1e-9 || previous.includes(record.gaugeDof)) throw new Error("Invalid release null basis");
      for (let axis = 0; axis < 3; axis++) if ((input.supports.some((support) => support.nodeId === record.nodeId && support.restraints[3 + axis]) || previous.includes(n * 6 + 3 + axis)) && Math.abs(components[axis]) > 1e-9) throw new Error("Release gauge overlaps a support or prior gauge");
      for (const member of input.members.filter((m) => m.startNodeId === record.nodeId || m.endNodeId === record.nodeId)) {
        const geometry = calculateMemberGeometry(input.nodes.find((node) => node.id === member.startNodeId)!.position, input.nodes.find((node) => node.id === member.endNodeId)!.position, member.rotationDegrees);
        const end = member.startNodeId === record.nodeId ? member.endReleases?.start : member.endReleases?.end;
        if (Math.abs(dot(geometry.localX)) > 1e-9 || !end?.my && Math.abs(dot(geometry.localY)) > 1e-9 || !end?.mz && Math.abs(dot(geometry.localZ)) > 1e-9) throw new Error("Gauge would suppress an active member rotation");
      }
      const moment = loadVector.slice(n * 6 + 3, n * 6 + 6).reduce((sum, value, i) => sum + value * components[i], 0);
      if (Math.abs(moment) > 1e-9) throw new Error("Unresisted moment in release gauge");
      previous.push(record.gaugeDof); releaseNullRotations.push({ nodeId: record.nodeId, direction, gaugeDof: record.gaugeDof });
    }
  }
  return { releaseGaugeDofs, releaseNullRotations };
}
