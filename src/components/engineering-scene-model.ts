import * as THREE from "three";
import { calculateMemberGeometry } from "../domain/member-geometry";
import { GEOMETRY_CONTRACT } from "../domain/geometry-policy";
import type { FrameMember, FrameNode, FrameSection, MemberId, NodeId } from "../domain/project";
import type { SectionGeometry } from "../domain/section-geometry";
import { createSectionExtrusion, memberSolidTransform, sectionOuterRadius } from "./member-solid";
import { disposeObjectTree } from "./three-resources";

export type EngineeringSceneSelection = { kind: "node"; id: NodeId } | { kind: "member"; id: MemberId } | null;
export type MemberDisplayMode = "solid" | "line";

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
  display: THREE.Line | THREE.Mesh;
  sectionGeometry?: SectionGeometry;
  batch?: { mesh: THREE.InstancedMesh; index: number };
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
  private readonly batchGroup = new THREE.Group();
  private batched = false;
  private displayMode: MemberDisplayMode = "solid";
  private resultTarget: EngineeringSceneSelection = null;

  constructor(
    private readonly parent: THREE.Group,
    private palette: EngineeringScenePalette,
    private readonly makeLabel: LabelFactory,
  ) {
    this.annotationGroup.name = "selection-annotations";
    this.parent.add(this.annotationGroup);
    this.parent.add(this.batchGroup);
  }

  sync(nodes: FrameNode[], members: FrameMember[], sections: FrameSection[] = [], displayMode: MemberDisplayMode = "solid"): void {
    this.displayMode = displayMode;
    const sectionsById = new Map(sections.map((section) => [section.id, section]));
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
      const sectionGeometry = sectionsById.get(member.sectionId)?.geometry;
      const fingerprint = JSON.stringify([member.startNodeId, member.endNodeId, start.position, end.position, member.rotationDegrees, sectionGeometry, displayMode]);
      const current = this.memberRecords.get(member.id);
      if (current?.fingerprint === fingerprint) {
        current.member = member; current.start = start; current.end = end;
        continue;
      }
      if (current) this.removeMember(member.id, current);
      this.memberRecords.set(member.id, this.createMember(member, start, end, fingerprint, sectionGeometry));
    }

    this.batched = nodes.length + members.length > 100;
    for (const record of this.nodeRecords.values()) record.display.visible = !this.batched;
    for (const record of this.memberRecords.values()) record.display.visible = !this.batched;
    this.rebuildBatch();
    this.applyInteractionState();
  }

  setSelection(selection: EngineeringSceneSelection): void {
    if (sameSelection(this.selection, selection)) return;
    this.selection = selection;
    this.applyInteractionState();
  }

  setResultTarget(memberId?: string): void {
    const target: EngineeringSceneSelection = memberId ? { kind: "member", id: memberId as MemberId } : null;
    if (sameSelection(this.resultTarget, target)) return;
    this.resultTarget = target;
    this.refreshAnnotations();
  }

  getBounds(): THREE.Box3 {
    const bounds = new THREE.Box3();
    for (const record of this.memberRecords.values()) bounds.expandByObject(record.display);
    for (const record of this.nodeRecords.values()) bounds.expandByPoint(new THREE.Vector3(record.node.position.x, record.node.position.y, record.node.position.z));
    return bounds;
  }

  setPalette(palette: EngineeringScenePalette): void {
    this.palette = palette;
    this.renderedAnnotationFingerprint = "";
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
    for (const child of [...this.batchGroup.children]) disposeObjectTree(child);
    this.batchGroup.removeFromParent();
    this.annotationGroup.removeFromParent();
  }

  private createNode(node: FrameNode, fingerprint: string): NodeRecord {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([node.position.x, node.position.y, node.position.z], 3));
    const display = new THREE.Points(geometry, new THREE.PointsMaterial({ color: this.palette.node, size: 4.5, sizeAttenuation: false, depthTest: false }));
    display.renderOrder = 2;

    const hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(GEOMETRY_CONTRACT.picking.nodeRadius, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hitTarget.position.set(node.position.x, node.position.y, node.position.z);
    hitTarget.visible = false;
    hitTarget.userData = { kind: "node", id: node.id };
    this.parent.add(display, hitTarget);
    return { fingerprint, display, hitTarget, node };
  }

  private createMember(member: FrameMember, start: FrameNode, end: FrameNode, fingerprint: string, sectionGeometry?: SectionGeometry): MemberRecord {
    const startVector = new THREE.Vector3(start.position.x, start.position.y, start.position.z);
    const endVector = new THREE.Vector3(end.position.x, end.position.y, end.position.z);
    const display = this.displayMode === "solid" && sectionGeometry ? new THREE.Mesh(
      createSectionExtrusion(sectionGeometry), new THREE.MeshLambertMaterial({ color: this.palette.member }),
    ) : new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([startVector, endVector]),
      new THREE.LineBasicMaterial({ color: this.palette.member }),
    );
    if (display instanceof THREE.Mesh) {
      display.matrixAutoUpdate = false;
      display.matrix.copy(memberSolidTransform(start.position, end.position, member.rotationDegrees));
      display.matrixWorldNeedsUpdate = true;
    }
    display.name = `member-display:${member.id}`;
    display.userData = { kind: "member", id: member.id };
    const length = startVector.distanceTo(endVector);
    const picking = GEOMETRY_CONTRACT.picking;
    const radius = Math.max(sectionOuterRadius(sectionGeometry), Math.min(picking.memberRadiusMax, Math.max(picking.memberRadiusMin, length * picking.memberLengthFactor)));
    const hitTarget = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    placeCylinderBetween(hitTarget, startVector, endVector);
    hitTarget.visible = false;
    hitTarget.userData = { kind: "member", id: member.id };
    this.parent.add(display, hitTarget);
    return { fingerprint, display, hitTarget, member, start, end, sectionGeometry };
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
    if (this.batched) this.colorBatch();
    this.refreshAnnotations();
  }

  private rebuildBatch(): void {
    for (const child of [...this.batchGroup.children]) disposeObjectTree(child);
    for (const record of this.memberRecords.values()) record.batch = undefined;
    if (!this.batched) return;
    const lines = Array.from(this.memberRecords.values()).filter((record) => record.display instanceof THREE.Line);
    const memberPoints = lines.flatMap((record) => [record.start.position, record.end.position]).flatMap((p) => [p.x, p.y, p.z]);
    const nodePoints = Array.from(this.nodeRecords.values()).flatMap((record) => [record.node.position.x, record.node.position.y, record.node.position.z]);
    const geometry = (points: number[]) => {
      const result = new THREE.BufferGeometry();
      result.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      result.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(points.length), 3));
      return result;
    };
    this.batchGroup.add(new THREE.LineSegments(geometry(memberPoints), new THREE.LineBasicMaterial({ vertexColors: true })));
    const dots = new THREE.Points(geometry(nodePoints), new THREE.PointsMaterial({ vertexColors: true, size: 4.5, sizeAttenuation: false, depthTest: false }));
    dots.renderOrder = 2;
    this.batchGroup.add(dots);
    const solids = new Map<string, MemberRecord[]>();
    for (const record of this.memberRecords.values()) {
      if (!(record.display instanceof THREE.Mesh)) continue;
      const key = JSON.stringify(record.sectionGeometry);
      const group = solids.get(key) ?? []; group.push(record); solids.set(key, group);
    }
    for (const records of solids.values()) {
      const mesh = new THREE.InstancedMesh(createSectionExtrusion(records[0].sectionGeometry!), new THREE.MeshLambertMaterial(), records.length);
      records.forEach((record, index) => {
        mesh.setMatrixAt(index, record.display.matrix);
        record.batch = { mesh, index };
      });
      mesh.computeBoundingSphere(); this.batchGroup.add(mesh);
    }
  }

  private colorBatch(): void {
    const [lines, dots] = this.batchGroup.children as [THREE.LineSegments, THREE.Points];
    if (!lines || !dots) return;
    const color = new THREE.Color();
    const selectedColor = (kind: "node" | "member", id: string, fallback: string) => this.selection?.kind === kind && this.selection.id === id ? this.palette.selected : this.hover?.kind === kind && this.hover.id === id ? this.palette.hovered : fallback;
    const lineColors = lines.geometry.getAttribute("color");
    let index = 0;
    for (const record of this.memberRecords.values()) {
      color.set(selectedColor("member", record.member.id, this.palette.member));
      if (record.batch) {
        record.batch.mesh.setColorAt(record.batch.index, color);
        record.batch.mesh.instanceColor!.needsUpdate = true;
      } else {
        lineColors.setXYZ(index++, color.r, color.g, color.b); lineColors.setXYZ(index++, color.r, color.g, color.b);
      }
    }
    lineColors.needsUpdate = true;
    const dotColors = dots.geometry.getAttribute("color"); index = 0;
    for (const record of this.nodeRecords.values()) {
      color.set(selectedColor("node", record.node.id, this.palette.node));
      dotColors.setXYZ(index++, color.r, color.g, color.b);
    }
    dotColors.needsUpdate = true;
  }

  private refreshAnnotations(): void {
    const fingerprint = `${this.annotationFingerprint("selection", this.selection)}|${this.annotationFingerprint("hover", this.hover)}|${this.annotationFingerprint("result", this.resultTarget)}`;
    if (fingerprint === this.renderedAnnotationFingerprint) return;
    this.clearAnnotations();
    if (this.selection) this.addAnnotation(this.selection, true);
    if (this.hover && !sameSelection(this.hover, this.selection)) this.addAnnotation(this.hover, false);
    if (this.resultTarget && !sameSelection(this.resultTarget, this.selection) && !sameSelection(this.resultTarget, this.hover)) this.addAnnotation(this.resultTarget, false, true);
    this.renderedAnnotationFingerprint = fingerprint;
  }

  private annotationFingerprint(role: string, selection: EngineeringSceneSelection): string {
    if (!selection) return `${role}:none`;
    if (selection.kind === "node") {
      const record = this.nodeRecords.get(selection.id);
      return `${role}:node:${selection.id}:${record?.fingerprint ?? "missing"}:${record?.node.label}`;
    }
    const record = this.memberRecords.get(selection.id);
    return `${role}:member:${selection.id}:${record?.fingerprint ?? "missing"}:${record?.member.label}`;
  }

  private addAnnotation(selection: NonNullable<EngineeringSceneSelection>, showLocalAxes: boolean, resultTarget = false): void {
    if (selection.kind === "node") {
      const record = this.nodeRecords.get(selection.id); if (!record) return;
      const label = this.makeLabel(record.node.label);
      label.userData.labelPriority = showLocalAxes ? 100 : 80;
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
    const radius = sectionOuterRadius(record.sectionGeometry);
    const label = this.makeLabel(record.member.label); label.userData.labelPriority = showLocalAxes ? 100 : resultTarget ? 90 : 80;
    label.position.copy(origin).add(new THREE.Vector3(0, 0, radius + 0.34)); this.annotationGroup.add(label);
    const highlight = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(record.start.position.x, record.start.position.y, record.start.position.z),
      new THREE.Vector3(record.end.position.x, record.end.position.y, record.end.position.z),
    ]), new THREE.LineBasicMaterial({ color: showLocalAxes || resultTarget ? this.palette.selected : this.palette.hovered, depthTest: false }));
    highlight.renderOrder = 4; this.annotationGroup.add(highlight);
    if (!showLocalAxes) return;
    const size = Math.min(0.85, Math.max(0.38, geometry.length * 0.16));
    origin.addScaledVector(new THREE.Vector3(geometry.localZ.x, geometry.localZ.y, geometry.localZ.z), radius + 0.12);
    for (const [axis, color] of [[geometry.localY, this.palette.axisY], [geometry.localZ, this.palette.axisZ]] as const) {
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(axis.x, axis.y, axis.z), origin, size, color, 0.12, 0.065);
      arrow.line.geometry = arrow.line.geometry.clone(); arrow.cone.geometry = arrow.cone.geometry.clone();
      (arrow.line.material as THREE.Material).depthTest = false; (arrow.cone.material as THREE.Material).depthTest = false;
      arrow.renderOrder = 4; arrow.line.renderOrder = 4; arrow.cone.renderOrder = 4;
      this.annotationGroup.add(arrow);
    }
  }

  private clearAnnotations(): void {
    for (const child of [...this.annotationGroup.children]) disposeObjectTree(child);
  }
}
