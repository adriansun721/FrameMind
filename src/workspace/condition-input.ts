import type { Vector3 } from "../domain/project";

/** Provenance carried by an unapplied task value. */
export type TaskValueSource = "existing" | "user" | "catalog" | "suggestion" | "assumption" | "unknown";
export type ConditionSource = TaskValueSource;
export function conditionObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("分析条件必须是对象");
  const result = value as Record<string, unknown>;
  const extra = Object.keys(result).find((key) => !allowed.includes(key));
  if (extra) throw new Error(`分析条件含未定义字段 ${extra}`);
  return result;
}
export function conditionVector(value: unknown): Vector3 {
  const v = conditionObject(value, ["x", "y", "z"]);
  if (![v.x, v.y, v.z].every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error("XYZ 分量必须全部为有限数值");
  return { x: v.x as number, y: v.y as number, z: v.z as number };
}
export function conditionIdentity(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("请指定有效的稳定身份或方案引用");
  return value;
}
export function conditionSource(value: unknown): ConditionSource {
  if (!["existing", "user", "catalog", "suggestion", "assumption", "unknown"].includes(value as string)) throw new Error("请标明任务值来源");
  return value as ConditionSource;
}
