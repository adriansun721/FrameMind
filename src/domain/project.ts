export const PROJECT_FORMAT = "framemind-project" as const;
export const PROJECT_FORMAT_VERSION = 1 as const;

declare const projectIdBrand: unique symbol;
declare const nodeIdBrand: unique symbol;
export type ProjectId = string & { readonly [projectIdBrand]: true };
export type NodeId = string & { readonly [nodeIdBrand]: true };

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface FrameNode {
  id: NodeId;
  label: string;
  position: Vector3;
}

export interface FrameProject {
  format: typeof PROJECT_FORMAT;
  formatVersion: typeof PROJECT_FORMAT_VERSION;
  id: ProjectId;
  name: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  units: {
    length: "m";
    force: "kN";
    moment: "kN·m";
  };
  nodes: FrameNode[];
  nextNodeNumber: number;
}

function createIdentity(): string {
  return globalThis.crypto.randomUUID();
}

export function createProject(name = "未命名项目"): FrameProject {
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    id: `project_${createIdentity()}` as ProjectId,
    name: name.trim() || "未命名项目",
    createdAt: now,
    updatedAt: now,
    revision: 0,
    units: {
      length: "m",
      force: "kN",
      moment: "kN·m",
    },
    nodes: [],
    nextNodeNumber: 1,
  };
}

export function addNode(project: FrameProject, position: Vector3): FrameProject {
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new Error("坐标必须是有限数值");
  }

  const nodeNumber = project.nextNodeNumber;
  const node: FrameNode = {
    id: `node_${String(nodeNumber).padStart(4, "0")}` as NodeId,
    label: `N${nodeNumber}`,
    position: { ...position },
  };

  return {
    ...project,
    nodes: [...project.nodes, node],
    nextNodeNumber: nodeNumber + 1,
    revision: project.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}
