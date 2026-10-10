import type { FrameProject } from "../domain/project";
import { encodeProject } from "../domain/project-file";

export interface ProjectSnapshotChange {
  collection: string;
  id: string;
  action: "create" | "delete" | "update";
  field: string;
  before: unknown;
  after: unknown;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Direction is current → restored. Compare persisted objects, including resources, conditions and receipts. */
export function diffProjectSnapshots(current: FrameProject, target: FrameProject): ProjectSnapshotChange[] {
  if (current.id !== target.id) throw new Error("历史快照属于其他项目");
  const before = JSON.parse(encodeProject(current)) as Record<string, unknown>, after = JSON.parse(encodeProject(target)) as Record<string, unknown>;
  const changes: ProjectSnapshotChange[] = [];
  const fields = (collection: string, id: string, a: unknown, b: unknown, path: string) => {
    if (object(a) && object(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) fields(collection, id, a[key], b[key], path ? `${path}.${key}` : key);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ collection, id, action: "update", field: path, before: a, after: b });
  };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key], b = after[key];
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((v) => object(v) && typeof v.id === "string")) {
      const old = new Map(a.map((v: Record<string, unknown>) => [String(v.id), v])), restored = new Map(b.map((v: Record<string, unknown>) => [String(v.id), v]));
      for (const id of new Set([...old.keys(), ...restored.keys()])) {
        if (!old.has(id) || !restored.has(id)) changes.push({ collection: key, id, action: old.has(id) ? "delete" : "create", field: "*", before: old.get(id), after: restored.get(id) });
        else fields(key, id, old.get(id), restored.get(id), "");
      }
      const oldOrder = a.map((v) => v.id), restoredOrder = b.map((v) => v.id);
      if (old.size === restored.size && [...old.keys()].every((id) => restored.has(id)) && JSON.stringify(oldOrder) !== JSON.stringify(restoredOrder)) fields("project", current.id, oldOrder, restoredOrder, `${key}.order`);
    } else fields("project", current.id, a, b, key);
  }
  return changes;
}
