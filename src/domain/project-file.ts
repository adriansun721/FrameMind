import {
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  type FrameNode,
  type FrameProject,
  type NodeId,
  type ProjectId,
} from "./project";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

function decodeNode(value: unknown): FrameNode {
  if (!isRecord(value)) {
    throw new Error("项目包含无效节点");
  }

  const id = requireString(value.id, "节点缺少稳定标识");
  const label = requireString(value.label, `节点 ${id} 缺少编号`);
  const position = value.position;
  if (
    !isRecord(position) ||
    ![position.x, position.y, position.z].every(
      (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  ) {
    throw new Error(`节点 ${id} 的坐标无效`);
  }

  return {
    id: id as NodeId,
    label,
    position: {
      x: position.x as number,
      y: position.y as number,
      z: position.z as number,
    },
  };
}

export function encodeProject(project: FrameProject): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function decodeProject(source: string): FrameProject {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("文件不是有效的 FrameMind 项目");
  }

  if (!isRecord(value) || value.format !== PROJECT_FORMAT) {
    throw new Error("文件不是有效的 FrameMind 项目");
  }

  if (value.formatVersion !== PROJECT_FORMAT_VERSION) {
    throw new Error(
      `项目版本 ${String(value.formatVersion)} 暂不受支持（当前支持版本 ${PROJECT_FORMAT_VERSION}）`,
    );
  }

  if (!Array.isArray(value.nodes)) {
    throw new Error("项目节点列表无效");
  }
  const nodes = value.nodes.map(decodeNode);
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) {
    throw new Error("项目包含重复的节点标识");
  }

  if (
    !isRecord(value.units) ||
    value.units.length !== "m" ||
    value.units.force !== "kN" ||
    value.units.moment !== "kN·m"
  ) {
    throw new Error("项目单位约定无效");
  }

  if (
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    value.revision >= Number.MAX_SAFE_INTEGER ||
    typeof value.nextNodeNumber !== "number" ||
    !Number.isSafeInteger(value.nextNodeNumber) ||
    value.nextNodeNumber < 1 ||
    value.nextNodeNumber >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("项目版本信息无效");
  }

  const highestUsedNodeNumber = nodes.reduce((highest, node) => {
    const idMatch = /^node_(\d+)$/.exec(node.id);
    const labelMatch = /^N(\d+)$/.exec(node.label);
    return Math.max(
      highest,
      idMatch ? Number(idMatch[1]) : 0,
      labelMatch ? Number(labelMatch[1]) : 0,
    );
  }, 0);
  if (value.nextNodeNumber <= highestUsedNodeNumber) {
    throw new Error("下一节点编号与已有节点冲突");
  }

  return {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    id: requireString(value.id, "项目缺少稳定标识") as ProjectId,
    name: requireString(value.name, "项目缺少名称"),
    createdAt: requireString(value.createdAt, "项目缺少创建时间"),
    updatedAt: requireString(value.updatedAt, "项目缺少更新时间"),
    revision: value.revision,
    units: { length: "m", force: "kN", moment: "kN·m" },
    nodes,
    nextNodeNumber: value.nextNodeNumber,
  };
}
