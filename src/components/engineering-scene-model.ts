import * as THREE from "three";
import { calculateMemberGeometry } from "../domain/member-geometry";
import type { FrameMember, FrameNode, MemberId, NodeId } from "../domain/project";
import { disposeObjectTree } from "./three-resources";

export type EngineeringSceneSelection = { kind: "node"; id: NodeId } | { kind: "member"; id: MemberId } | null;

export interface EngineeringScenePalette {
  member: string;
  node: string;
  hovered: string;
  selected: string;
  axisY: string;
  axisZ: string;
}

type LabelFactory = (text: string) => THREE.Sprite;

interface NodeRecord {
  fingerprint: string;
  display: THREE.Points;
  hitTarget: THREE.Mesh;
  node: FrameNode;
}

interface MemberRecord {
  fingerprint: string;
  display: THREE.Line;
  hitTarget: THREE.Mesh;
  member: FrameMember;
  start: FrameNode;
  end: FrameNode;
}

function sameSelection(left: EngineeringSceneSelection, right: EngineeringSceneSelection): boolean {
  return left?.kind === right?.kind && left?.id === right?.id;
}

function placeCylinderBetween(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
}

export class EngineeringSceneModel {
  private readonly annotationGroup = new THREE.Group();
  private readonly memberRecords = new Map<MemberId, MemberRecord>();
  private readonly nodeRecords = new Map<NodeId, NodeRecord>();
  private selection: EngineeringSceneSelection = null;
  private hover: EngineeringSceneSelection = null;
  private renderedAnnotationFingerprint = "";

  constructor(
    private readonly parent: THREE.Group,
    private readonly palette: EngineeringScenePalette,
    private readonly makeLabel: LabelFactory,
  ) {
    this.annotationGroup.name = "selection-annotations";
    this.parent.add(this.annotationGroup);
  }

  sync(nodes: FrameNode[], members: FrameMember[]): void {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const membersById = new Map(members.map((member) => [member.id, member]));
    const currentNodeIds = new Set(nodes.map((node) => node.id));
    const currentMemberIds = new Set(members.map((member) => member.id));

    for (const [id, record] of this.nodeRecords) {
      if (!currentNodeIds.has(id)) this.removeNode(id, record);
    }
    for (const [id, record] of this.memberRecords) {
      const member = membersById.get(record.member.id);
      const valid = member && nodesById.has(member.startNodeId) && nodesById.has(member.endNodeId);
      if (!currentMemberIds.has(id) || !valid) this.removeMember(id, record);
    }

    for (const node of nodes) {
      const fingerprint = `${node.position.x}|${node.position.y}|${node.position.z}`;
      const current = this.nodeRecords.get(node.id);
      if (current?.fingerprint === fingerprint) {
        current.node = node;
        continue;
      }
      if (current) this.removeNode(node.id, current);
      this.nodeRecords.set(node.id, this.createNode(node, fingerprint));
    }

    for (const member of members) {
      const start = nodesById.get(member.startNodeId); const end = nodesById.get(member.endNodeId);
      if (!start || !end) continue;
      const fingerprint = [member.startNodeId, member.endNodeId, start.position.x, start.position.y, start.position.z, end.position.x, end.position.y, end.position.z].join("|");
      const current = this.memberRecords.get(member.id);
      if (current?.fingerprint === fingerprint) {
        current.member = member; current.start = start; current.end = end;
        continue;
      }
      if (current) this.removeMember(member.id, current);
      this.memberRecords.set(member.id, this.createMember(member, start, end, fingerprint));
    }

    this.applyInteractionState();
  }

  setSelection(selection: EngineeringSceneSelection): void {
    if (sameSelection(this.selection, selection)) return;
    this.selection = selection;
    this.applyInteractionState();
  }

  setHover(hover: EngineeringSceneSelection): void {
    if (sameSelection(this.hover, hover)) return;
    this.hover = hover;
    this.applyInteractionState();
  }

  getHitTargets(): THREE.Object3D[] {
    return [
      ...Array.from(this.memberRecords.values(), (record) => record.hitTarget),
      ...Array.from(this.nodeRecords.values(), (record) => record.hitTarget),
    ];
  }

  dispose(): void {
    for (const [id, record] of this.memberRecords) this.removeMember(id, record);
    for (const [id, record] of this.nodeRecords) this.removeNode(id, record);
    this.clearAnnotations();
    this.annotationGroup.removeFromParent();
  }

  private createNode(node: FrameNode, fingerprint: string): NodeRecord {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([node.position.x, node.position.y, node.position.z], 3));
    const display = new THREE.Points(geometry, new THREE.PointsMaterial({ color: this.palette.node, size: 4.5, sizeAttenuation: false }));
    display.renderOrder = 2;

    const hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hitTarget.position.set(node.position.x, node.position.y, node.position.z);
    hitTarget.userData = { kind: "node", id: node.id };
    this.parent.add(display, hitTarget);
    return { fingerprint, display, hitTarget, node };
  }

  private createMember(member: FrameMember, start: FrameNode, end: FrameNode, fingerprint: string): MemberRecord {
    const startVector = new THREE.Vector3(start.position.x, start.position.y, start.position.z);
    const endVector = new THREE.Vector3(end.position.x, end.position.y, end.position.z);
    const display = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([startVector, endVector]),
      new THREE.LineBasicMaterial({ color: this.palette.member }),
    );
    const length = startVector.distanceTo(endVector);
    const hitTarget = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.min(0.16, Math.max(0.08, length * 0.02)), Math.min(0.16, Math.max(0.08, length * 0.02)), length, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    placeCylinderBetween(hitTarget, startVector, endVector);
    hitTarget.userData = { kind: "member", id: member.id };
    this.parent.add(display, hitTarget);
    return { fingerprint, display, hitTarget, member, start, end };
  }

  private removeNode(id: NodeId, record: NodeRecord): void {
    disposeObjectTree(record.display); disposeObjectTree(record.hitTarget); this.nodeRecords.delete(id);
  }

  private removeMember(id: MemberId, record: MemberRecord): void {
    disposeObjectTree(record.display); disposeObjectTree(record.hitTarget); this.memberRecords.delete(id);
  }

  private applyInteractionState(): void {
    for (const record of this.nodeRecords.values()) {
      const selected = this.selection?.kind === "node" && this.selection.id === record.node.id;
      const hovered = this.hover?.kind === "node" && this.hover.id === record.node.id;
      const material = record.display.material as THREE.PointsMaterial;
      material.color.set(selected ? this.palette.selected : hovered ? this.palette.hovered : this.palette.node);
      material.size = selected ? 6.5 : hovered ? 5.5 : 4.5;
    }
    for (const record of this.memberRecords.values()) {
      const selected = this.selection?.kind === "member" && this.selection.id === record.member.id;
      const hovered = this.hover?.kind === "member" && this.hover.id === record.member.id;
      (record.display.material as THREE.LineBasicMaterial).color.set(selected ? this.palette.selected : hovered ? this.palette.hovered : this.palette.member);
    }
    this.refreshAnnotations();
  }

  private refreshAnnotations(): void {
    const fingerprint = `${this.annotationFingerprint("selection", this.selection)}|${this.annotationFingerprint("hover", this.hover)}`;
    if (fingerprint === this.renderedAnnotationFingerprint) return;
    this.clearAnnotations();
    if (this.selection) this.addAnnotation(this.selection, true);
    if (this.hover && !sameSelection(this.hover, this.selection)) this.addAnnotation(this.hover, false);
    this.renderedAnnotationFingerprint = fingerprint;
  }

  private annotationFingerprint(role: string, selection: EngineeringSceneSelection): string {
    if (!selection) return `${role}:none`;
    if (selection.kind === "node") {
      const record = this.nodeRecords.get(selection.id);
      return `${role}:node:${selection.id}:${record?.fingerprint ?? "missing"}`;
    }
    const record = this.memberRecords.get(selection.id);
    return `${role}:member:${selection.id}:${record?.fingerprint ?? "missing"}:${record?.member.rotationDegrees ?? ""}`;
  }

  private addAnnotation(selection: NonNullable<EngineeringSceneSelection>, showLocalAxes: boolean): void {
    if (selection.kind === "node") {
      const record = this.nodeRecords.get(selection.id); if (!record) return;
      const label = this.makeLabel(record.node.label);
      label.position.set(record.node.position.x, record.node.position.y, record.node.position.z + 0.34);
      this.annotationGroup.add(label);
      return;
    }

    const record = this.memberRecords.get(selection.id); if (!record) return;
    const geometry = calculateMemberGeometry(record.start.position, record.end.position, record.member.rotationDegrees);
    const origin = new THREE.Vector3(
      (record.start.position.x + record.end.position.x) / 2,
      (record.start.position.y + record.end.position.y) / 2,
      (record.start.position.z + record.end.position.z) / 2,
    );
    const label = this.makeLabel(record.member.label); label.position.copy(origin).add(new THREE.Vector3(0, 0, 0.34)); this.annotationGroup.add(label);
    if (!showLocalAxes) return;
    const size = Math.min(0.85, Math.max(0.38, geometry.length * 0.16));
    this.annotationGroup.add(new THREE.ArrowHelper(new THREE.Vector3(geometry.localY.x, geometry.localY.y, geometry.localY.z), origin, size, this.palette.axisY, 0.12, 0.065));
    this.annotationGroup.add(new THREE.ArrowHelper(new THREE.Vector3(geometry.localZ.x, geometry.localZ.y, geometry.localZ.z), origin, size, this.palette.axisZ, 0.12, 0.065));
  }

  private clearAnnotations(): void {
    for (const child of [...this.annotationGroup.children]) disposeObjectTree(child);
  }
}
