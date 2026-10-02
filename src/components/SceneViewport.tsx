import { useEffect, useRef } from "react";
import { Scan } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { FrameMaterial, FrameMember, FrameNode, FrameNodalLoad, FrameSection, FrameSupport, FrameUniformLoad, LoadId, MemberId, NodeId, ProjectId, SupportId } from "../domain/project";
import { calculateMemberGeometry } from "../domain/member-geometry";
import { uniformLoadVector } from "../domain/uniform-loads";
import { getMemberResponseSamples, type AnalysisResult } from "../domain/analysis";
import { EngineeringSceneModel, type EngineeringScenePalette, type EngineeringSceneSelection } from "./engineering-scene-model";
import { calculateSceneFrame } from "./scene-camera";
import { disposeObjectTree } from "./three-resources";
import type { AppTheme } from "../../electron/contracts";
import type { FramePreview } from "../workspace/frame-proposal";

export type SceneSelection = EngineeringSceneSelection;
export type ResultViewMode = "model" | "deformation" | "forces";
export type ForceComponent = "N" | "Vy" | "Vz" | "T" | "My" | "Mz";
export type SceneConditionSelection = { kind: "support"; id: SupportId } | { kind: "load"; id: LoadId };

interface SceneViewportProps {
  preview?: FramePreview | null;
  theme?: AppTheme;
  supports?: FrameSupport[];
  nodalLoads?: FrameNodalLoad[];
  conditionSelection?: SceneConditionSelection | null;
  onSelectCondition?(selection: SceneConditionSelection): void;
  projectId: ProjectId;
  nodes: FrameNode[];
  members: FrameMember[];
  materials: FrameMaterial[];
  sections: FrameSection[];
  uniformLoads?: FrameUniformLoad[];
  sourceLabel?: string;
  selectedUniformLoadId?: LoadId;
  onSelectUniformLoad?(id: LoadId): void;
  analysis?: AnalysisResult;
  resultView?: ResultViewMode;
  forceComponent?: ForceComponent;
  deformationScale?: number;
  resultFocus?: { memberId: string; position: number } | null;
  selection: SceneSelection;
  fitRequest?: number;
  onSelect(selection: SceneSelection): void;
}

interface ScenePalette extends EngineeringScenePalette {
  load: string;
  loadSelected: string;
  support: string;
  moment: string;
  deformation: string;
  force: string;
  canvas: string;
  gridMajor: string;
  gridMinor: string;
  axisX: string;
  labelSurface: string;
  labelBorder: string;
  labelText: string;
}

interface SceneRuntime {
  scene: THREE.Scene;
  grid: THREE.GridHelper;
  axes: THREE.AxesHelper;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  model: EngineeringSceneModel;
  renderer: THREE.WebGLRenderer;
  projectId: ProjectId | null;
  hasFramedModel: boolean;
  loads: THREE.Group;
  results: THREE.Group;
  conditions: THREE.Group;
  preview: THREE.Group;
}

function readScenePalette(): ScenePalette {
  const styles = getComputedStyle(document.documentElement);
  const color = (token: string) => styles.getPropertyValue(token).trim();
  return {
    load: color("--model-load"),
    loadSelected: color("--model-load-selected"),
    support: color("--model-support"),
    moment: color("--model-moment"),
    deformation: color("--model-deformation"),
    force: color("--model-force"),
    canvas: color("--surface-canvas"),
    gridMajor: color("--model-grid-major"),
    gridMinor: color("--model-grid-minor"),
    member: color("--model-default"),
    node: color("--model-node"),
    hovered: color("--model-hover"),
    selected: color("--model-selected"),
    axisX: color("--model-axis-x"),
    axisY: color("--model-axis-y"),
    axisZ: color("--model-axis-z"),
    labelSurface: color("--model-label-surface"),
    labelBorder: color("--model-label-border"),
    labelText: color("--model-label-text"),
  };
}

function makeLabel(text: string, palette: ScenePalette): THREE.Sprite {
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 48;
  const context = canvas.getContext("2d")!;
  context.fillStyle = palette.labelSurface; context.beginPath(); context.roundRect(18, 7, 92, 32, 5); context.fill();
  context.strokeStyle = palette.labelBorder; context.lineWidth = 1; context.stroke();
  context.font = "600 18px Segoe UI, sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
  context.fillStyle = palette.labelText; context.fillText(text, 64, 23);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, sizeAttenuation: false }));
  const height = document.querySelector(".viewport")?.clientHeight ?? 600;
  sizeLabel(sprite, height); sprite.center.set(0, 0.5); sprite.renderOrder = 3;
  return sprite;
}

function sizeLabel(sprite: THREE.Sprite, viewportHeight: number): void {
  const scale = 2 * Math.tan(21 * Math.PI / 180) / Math.max(1, viewportHeight);
  sprite.scale.set(68 * scale, 25.5 * scale, 1);
}

function makeArrow(direction: THREE.Vector3, origin: THREE.Vector3, length: number, color: string): THREE.ArrowHelper {
  const arrow = new THREE.ArrowHelper(direction, origin, length, color, length * 0.25, length * 0.14);
  arrow.line.geometry = arrow.line.geometry.clone(); arrow.cone.geometry = arrow.cone.geometry.clone();
  return arrow;
}

function applySceneFrame(camera: THREE.PerspectiveCamera, controls: OrbitControls, nodes: FrameNode[]): void {
  const frame = calculateSceneFrame(nodes, camera.aspect);
  camera.position.set(frame.camera.x, frame.camera.y, frame.camera.z);
  camera.far = frame.far;
  camera.updateProjectionMatrix();
  controls.target.set(frame.target.x, frame.target.y, frame.target.z);
  controls.maxDistance = Math.max(70, frame.far / 3);
  controls.update();
}

function cameraState(camera: THREE.PerspectiveCamera, controls: OrbitControls): string {
  const values = [camera.position.x, camera.position.y, camera.position.z, controls.target.x, controls.target.y, controls.target.z, camera.zoom];
  return values.map((value) => value.toFixed(6)).join(",");
}

function selectionFromHit(hit: THREE.Intersection): SceneSelection {
  return hit.object.userData.kind === "node"
    ? { kind: "node", id: String(hit.object.userData.id) as NodeId }
    : { kind: "member", id: String(hit.object.userData.id) as MemberId };
}

export function SceneViewport({ preview, theme = "dark", supports, nodalLoads, conditionSelection, onSelectCondition, projectId, nodes, members, materials, sections, selection, onSelect, uniformLoads, sourceLabel, selectedUniformLoadId, onSelectUniformLoad, analysis, resultView = "model", forceComponent = "N", deformationScale = 100, resultFocus, fitRequest = 0 }: SceneViewportProps) {
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onSelectLoadRef = useRef(onSelectUniformLoad); onSelectLoadRef.current = onSelectUniformLoad;
  const onSelectConditionRef = useRef(onSelectCondition); onSelectConditionRef.current = onSelectCondition;
  const selectedLoad = uniformLoads?.find((load) => load.id === selectedUniformLoadId);
  const selectedMember = selection?.kind === "member" ? members.find((member) => member.id === selection.id) : undefined;
  const selectedMaterial = selectedMember ? materials.find((material) => material.id === selectedMember.materialId) : undefined;
  const selectedSection = selectedMember ? sections.find((section) => section.id === selectedMember.sectionId) : undefined;
  const selectedNode = selection?.kind === "node" ? nodes.find((node) => node.id === selection.id) : undefined;
  const selectedSupport = conditionSelection?.kind === "support" ? supports?.find((support) => support.id === conditionSelection.id) : undefined;
  const selectedNodalLoad = conditionSelection?.kind === "load" ? nodalLoads?.find((load) => load.id === conditionSelection.id) : undefined;

  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    const palette = readScenePalette();
    const scene = new THREE.Scene(); scene.background = new THREE.Color(palette.canvas);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200); camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.minDistance = 2; controls.maxDistance = 70;
    applySceneFrame(camera, controls, []);
    const updateCameraState = () => { host.dataset.cameraState = cameraState(camera, controls); };
    controls.addEventListener("change", updateCameraState); updateCameraState();

    const grid = new THREE.GridHelper(30, 30, palette.gridMajor, palette.gridMinor); grid.rotation.x = Math.PI / 2;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) { material.transparent = true; material.opacity = 0.42; }
    scene.add(grid);
    const axes = new THREE.AxesHelper(1.45); axes.setColors(palette.axisX, palette.axisY, palette.axisZ); axes.position.set(-0.01, -0.01, 0.02);
    const axesMaterial = axes.material as THREE.LineBasicMaterial; axesMaterial.transparent = true; axesMaterial.opacity = 0.72; scene.add(axes);
    const modelGroup = new THREE.Group(); modelGroup.name = "engineering-model"; scene.add(modelGroup);
    const model = new EngineeringSceneModel(modelGroup, palette, (text) => makeLabel(text, readScenePalette()));
    const loads = new THREE.Group(); scene.add(loads);
    const results = new THREE.Group(); results.name = "analysis-results"; scene.add(results);
    const conditions = new THREE.Group(); scene.add(conditions);
    const previewGroup = new THREE.Group(); previewGroup.name = "unapplied-frame-preview"; scene.add(previewGroup);
    runtimeRef.current = { scene, grid, axes, camera, controls, model, renderer, loads, results, conditions, preview: previewGroup, projectId: null, hasFramedModel: false };

    const raycaster = new THREE.Raycaster(); raycaster.params.Line.threshold = 0.04;
    const pointer = new THREE.Vector2(); let pointerStart: THREE.Vector2 | null = null;
    const hitAtPointer = (event: PointerEvent): THREE.Intersection | undefined => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1; pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return [...raycaster.intersectObjects(model.getHitTargets(), false), ...raycaster.intersectObjects(loads.children, true), ...raycaster.intersectObjects(conditions.children, true)].sort((a, b) => a.distance - b.distance)[0];
    };
    const beginPointer = (event: PointerEvent) => { if (event.button === 0) pointerStart = new THREE.Vector2(event.clientX, event.clientY); };
    const finishPointer = (event: PointerEvent) => {
      if (event.button !== 0 || !pointerStart) return;
      const moved = pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)); pointerStart = null;
      if (moved > 4) return;
      const hit = hitAtPointer(event);
      if (hit?.object.userData.kind === "uniform-load") onSelectLoadRef.current?.(hit.object.userData.id as LoadId);
      else if (hit?.object.userData.kind === "support" || hit?.object.userData.kind === "load") onSelectConditionRef.current?.(hit.object.userData as SceneConditionSelection);
      else onSelectRef.current(hit ? selectionFromHit(hit) : null);
    };
    const hoverPointer = (event: PointerEvent) => {
      if (event.buttons !== 0) { model.setHover(null); return; }
      const hit = hitAtPointer(event); model.setHover(hit && ["node", "member"].includes(hit.object.userData.kind) ? selectionFromHit(hit) : null);
      renderer.domElement.style.cursor = hit ? "pointer" : "default";
    };
    const clearHover = () => { model.setHover(null); renderer.domElement.style.cursor = "default"; };
    renderer.domElement.addEventListener("pointerdown", beginPointer);
    renderer.domElement.addEventListener("pointerup", finishPointer);
    renderer.domElement.addEventListener("pointermove", hoverPointer);
    renderer.domElement.addEventListener("pointerleave", clearHover);

    const resize = () => {
      const { width, height } = host.getBoundingClientRect(); if (!width || !height) return;
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
      scene.traverse((object) => { if (object instanceof THREE.Sprite) sizeLabel(object, height); });
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    let animationFrame = 0;
    const render = () => { controls.update(); renderer.render(scene, camera); animationFrame = requestAnimationFrame(render); };
    render();

    return () => {
      cancelAnimationFrame(animationFrame); observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", beginPointer);
      renderer.domElement.removeEventListener("pointerup", finishPointer);
      renderer.domElement.removeEventListener("pointermove", hoverPointer);
      renderer.domElement.removeEventListener("pointerleave", clearHover);
      controls.removeEventListener("change", updateCameraState); controls.dispose(); model.dispose(); disposeObjectTree(scene); renderer.dispose(); renderer.domElement.remove();
      if (runtimeRef.current?.renderer === renderer) runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    const palette = readScenePalette();
    runtime.scene.background = new THREE.Color(palette.canvas);
    const themedGrid = new THREE.GridHelper(30, 30, palette.gridMajor, palette.gridMinor);
    const colors = runtime.grid.geometry.getAttribute("color") as THREE.BufferAttribute;
    colors.array.set(themedGrid.geometry.getAttribute("color").array);
    colors.needsUpdate = true;
    disposeObjectTree(themedGrid);
    runtime.axes.setColors(palette.axisX, palette.axisY, palette.axisZ);
    runtime.model.setPalette(palette);
  }, [theme]);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    if (runtime.projectId !== projectId) {
      runtime.projectId = projectId;
      runtime.hasFramedModel = false;
      runtime.model.setHover(null);
    }
    runtime.model.sync(nodes, members);
    if (nodes.length === 0) runtime.hasFramedModel = false;
    if (!runtime.hasFramedModel && nodes.length > 0) {
      applySceneFrame(runtime.camera, runtime.controls, nodes);
      runtime.hasFramedModel = true;
    }
  }, [projectId, nodes, members]);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    for (const child of [...runtime.preview.children]) disposeObjectTree(child);
    if (!preview?.nodes.length) return;
    const color = getComputedStyle(document.documentElement).getPropertyValue("--model-preview").trim();
    const nodesById = new Map(preview.nodes.map((node) => [node.id, node]));
    const points = preview.members.flatMap((member) => [member.startNodeId, member.endNodeId].map((id) => {
      const p = nodesById.get(id)!.position; return new THREE.Vector3(p.x, p.y, p.z);
    }));
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color, dashSize: 0.22, gapSize: 0.12, transparent: true, opacity: 0.9, depthTest: false }));
    lines.computeLineDistances(); lines.renderOrder = 4; runtime.preview.add(lines);
    const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(preview.nodes.map((node) => new THREE.Vector3(node.position.x, node.position.y, node.position.z))), new THREE.PointsMaterial({ color, size: 5, sizeAttenuation: false, depthTest: false }));
    dots.renderOrder = 5; runtime.preview.add(dots);
    applySceneFrame(runtime.camera, runtime.controls, [...nodes, ...preview.nodes]);
  }, [preview, nodes, theme]);

  useEffect(() => { runtimeRef.current?.model.setSelection(selection); }, [selection, nodes, members]);
  useEffect(() => {
    const group = runtimeRef.current?.conditions; if (!group) return;
    for (const child of [...group.children]) disposeObjectTree(child);
    const palette = readScenePalette();
    const pointAt = (node: FrameNode) => new THREE.Vector3(node.position.x, node.position.y, node.position.z);
    const addLine = (layer: THREE.Group, points: THREE.Vector3[], color: string) => layer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })));
    for (const support of supports ?? []) {
      const node = nodes.find((item) => item.id === support.nodeId); if (!node || !support.restraints.some(Boolean)) continue;
      const layer = new THREE.Group(); const point = pointAt(node);
      const color = conditionSelection?.kind === "support" && conditionSelection.id === support.id ? palette.selected : palette.support;
      const base = [[-0.22, -0.22], [0.22, -0.22], [0.22, 0.22], [-0.22, 0.22]].map(([x, y]) => point.clone().add(new THREE.Vector3(x, y, -0.3)));
      addLine(layer, [...base, base[0]], color);
      for (const corner of base) addLine(layer, [point, corner], color);
      const label = makeLabel(support.label, palette); label.position.copy(point).add(new THREE.Vector3(0.38, 0, -0.3)); layer.add(label);
      layer.traverse((object) => { object.userData = { kind: "support", id: support.id }; }); group.add(layer);
    }
    for (const load of nodalLoads ?? []) {
      const node = nodes.find((item) => item.id === load.nodeId); if (!node) continue;
      const layer = new THREE.Group(); const point = pointAt(node);
      const selected = conditionSelection?.kind === "load" && conditionSelection.id === load.id;
      const force = new THREE.Vector3(load.force.x, load.force.y, load.force.z);
      if (force.length() > 0) {
        force.normalize(); layer.add(makeArrow(force, point.clone().addScaledVector(force, -0.8), 0.8, selected ? palette.loadSelected : palette.load));
      }
      const moment = new THREE.Vector3(load.moment.x, load.moment.y, load.moment.z);
      if (moment.length() > 0) {
        moment.normalize();
        const reference = Math.abs(moment.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
        const u = new THREE.Vector3().crossVectors(moment, reference).normalize();
        const v = new THREE.Vector3().crossVectors(moment, u).normalize();
        const center = point.clone().addScaledVector(moment, 0.5);
        const arc = Array.from({ length: 33 }, (_, index) => {
          const angle = index / 32 * Math.PI * 1.7;
          return center.clone().addScaledVector(u, Math.cos(angle) * 0.3).addScaledVector(v, Math.sin(angle) * 0.3);
        });
        const color = selected ? palette.loadSelected : palette.moment;
        addLine(layer, arc, color);
        const tangent = arc[32].clone().sub(arc[31]).normalize();
        layer.add(makeArrow(tangent, arc[32].clone().addScaledVector(tangent, -0.16), 0.16, color));
      }
      if (layer.children.length > 0) {
        const label = makeLabel(load.label, palette); label.position.copy(point).add(new THREE.Vector3(0.4, 0, 0.55)); layer.add(label);
        layer.traverse((object) => { object.userData = { kind: "load", id: load.id }; }); group.add(layer);
      }
    }
  }, [supports, nodalLoads, nodes, conditionSelection, theme]);
  useEffect(() => {
    const group = runtimeRef.current?.loads;
    if (!group) return;
    for (const child of [...group.children]) disposeObjectTree(child);
    for (const [index, load] of (uniformLoads ?? []).entries()) {
      const member = members.find((item) => item.id === load.memberId);
      const start = nodes.find((item) => item.id === member?.startNodeId);
      const end = nodes.find((item) => item.id === member?.endNodeId);
      if (!member || !start || !end) continue;
      const geometry = calculateMemberGeometry(start.position, end.position, member.rotationDegrees);
      const globalQ = uniformLoadVector(load, geometry, "global");
      const direction = new THREE.Vector3(globalQ.x, globalQ.y, globalQ.z);
      const magnitude = direction.length();
      if (magnitude === 0 || !Number.isFinite(magnitude)) continue;
      direction.normalize();
      const arrowLength = Math.min(0.8, Math.max(0.2, geometry.length * 0.16));
      const palette = readScenePalette();
      const color = selectedUniformLoadId === load.id ? palette.loadSelected : palette.load;
      const layer = new THREE.Group();
      const tails: THREE.Vector3[] = [];
      for (let station = 0; station < 5; station += 1) {
        const head = new THREE.Vector3(start.position.x, start.position.y, start.position.z).lerp(new THREE.Vector3(end.position.x, end.position.y, end.position.z), (station + 0.5) / 5);
        head.addScaledVector(new THREE.Vector3(geometry.localZ.x, geometry.localZ.y, geometry.localZ.z), index * arrowLength * 0.3);
        const tail = head.clone().addScaledVector(direction, -arrowLength); tails.push(tail);
        layer.add(makeArrow(direction, tail, arrowLength, color));
      }
      layer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tails[0], tails[4]]), new THREE.LineBasicMaterial({ color })));
      const label = makeLabel(load.label, readScenePalette()); label.position.copy(tails[2]).addScaledVector(direction, -arrowLength * 0.3); layer.add(label);
      layer.traverse((object) => { object.userData = { kind: "uniform-load", id: load.id }; }); group.add(layer);
    }
  }, [uniformLoads, nodes, members, selectedUniformLoadId, theme]);
  useEffect(() => {
    const group = runtimeRef.current?.results;
    if (!group) return;
    for (const child of [...group.children]) disposeObjectTree(child);
    if (!analysis || resultView === "model") return;
    const inputNodes = new Map(analysis.input.nodes.map((node) => [node.id, node]));
    const palette = readScenePalette();
    const componentIndex: Record<ForceComponent, number> = { N: 0, Vy: 1, Vz: 2, T: 3, My: 4, Mz: 5 };
    const allValues: number[] = [];
    const memberSamples = new Map<string, ReturnType<typeof getMemberResponseSamples>>();
    for (const member of analysis.members) {
      try {
        const samples = getMemberResponseSamples(analysis, member.memberId, 25);
        memberSamples.set(member.memberId, samples);
        if (resultView === "forces") for (const sample of samples) allValues.push(Math.abs(sample.forces[componentIndex[forceComponent]]));
      } catch { /* incompatible historic results remain visible in the table */ }
    }
    const maxValue = Math.max(...allValues, 0);
    const modelExtent = Math.max(...analysis.input.nodes.flatMap((node) => [Math.abs(node.position.x), Math.abs(node.position.y), Math.abs(node.position.z)]), 1);
    const scale = resultView === "deformation" ? Math.max(1, deformationScale) : maxValue < 1e-9 ? 0 : Math.max(0.18, modelExtent * 0.22) / maxValue;
    const lineMaterial = (color: string, opacity = 0.92) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    const addPath = (points: THREE.Vector3[], color: string, width = 1) => {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial(color));
      line.renderOrder = 4; line.userData = { result: true }; group.add(line);
      if (width > 1) (line.material as THREE.LineBasicMaterial).linewidth = width;
    };
    for (const member of analysis.members) {
      const sourceMember = analysis.input.members.find((item) => item.id === member.memberId);
      const original = sourceMember ? inputNodes.get(sourceMember.startNodeId) : undefined;
      const originalEnd = sourceMember ? inputNodes.get(sourceMember.endNodeId) : undefined;
      const samples = memberSamples.get(member.memberId);
      if (!original || !originalEnd || !samples) continue;
      const start = new THREE.Vector3(original.position.x, original.position.y, original.position.z);
      const end = new THREE.Vector3(originalEnd.position.x, originalEnd.position.y, originalEnd.position.z);
      const geometry = calculateMemberGeometry(original.position, originalEnd.position, sourceMember?.rotationDegrees ?? 0);
      if (resultView === "deformation") {
        const points = samples.map((sample) => {
          const base = start.clone().lerp(end, sample.position / geometry.length);
          return base.add(new THREE.Vector3(sample.globalDisplacement.x, sample.globalDisplacement.y, sample.globalDisplacement.z).multiplyScalar(scale));
        });
        addPath(points, palette.deformation, 2);
      } else {
        const index = componentIndex[forceComponent];
        const diagramAxis = forceComponent === "Vy" || forceComponent === "My" ? geometry.localZ : geometry.localY;
        const direction = new THREE.Vector3(diagramAxis.x, diagramAxis.y, diagramAxis.z);
        const points = samples.map((sample) => {
          const base = start.clone().lerp(end, sample.position / geometry.length);
          return base.addScaledVector(direction, sample.forces[index] * scale);
        });
        addPath(points, palette.force, 2);
        addPath([start, end], palette.member, 1);
      }
    }
    if (resultFocus) {
      const member = analysis.input.members.find((item) => item.id === resultFocus.memberId);
      const start = member && inputNodes.get(member.startNodeId); const end = member && inputNodes.get(member.endNodeId);
      if (member && start && end) {
        const geometry = calculateMemberGeometry(start.position, end.position, member.rotationDegrees);
        const ratio = Math.max(0, Math.min(1, resultFocus.position / geometry.length));
        const point = new THREE.Vector3(start.position.x, start.position.y, start.position.z).lerp(new THREE.Vector3(end.position.x, end.position.y, end.position.z), ratio);
        const focusedSamples = memberSamples.get(member.id);
        const nearest = focusedSamples?.reduce((best, sample) => Math.abs(sample.position - resultFocus.position) < Math.abs(best.position - resultFocus.position) ? sample : best);
        if (nearest && resultView === "deformation") point.add(new THREE.Vector3(nearest.globalDisplacement.x, nearest.globalDisplacement.y, nearest.globalDisplacement.z).multiplyScalar(scale));
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: palette.selected }));
        marker.position.copy(point); marker.renderOrder = 5; group.add(marker);
      }
    }
  }, [analysis, resultView, forceComponent, deformationScale, resultFocus, nodes, theme]);
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime && fitRequest > 0) applySceneFrame(runtime.camera, runtime.controls, nodesRef.current);
  }, [fitRequest]);

  const fitModel = () => {
    const runtime = runtimeRef.current;
    if (!runtime || nodes.length + (preview?.nodes.length ?? 0) === 0) return;
    const bounds = new THREE.Box3();
    for (const node of [...nodes, ...(preview?.nodes ?? [])]) bounds.expandByPoint(new THREE.Vector3(node.position.x, node.position.y, node.position.z));
    for (const group of [runtime.loads, runtime.conditions, runtime.results]) bounds.expandByObject(group);
    const corners = [bounds.min, bounds.max].map((point) => ({ ...(nodes[0] ?? preview!.nodes[0]), position: { x: point.x, y: point.y, z: point.z } }));
    applySceneFrame(runtime.camera, runtime.controls, corners);
  };

  return (
    <div className="viewport" ref={hostRef} aria-label="三维模型视图">
      <div className="viewport-topline"><span className="view-chip">分析线 · 透视</span><div className="viewport-tools"><span className="view-hint">单击选择 · 拖动旋转 · 滚轮缩放</span><button className="icon-button" aria-label="适合模型" title="适合模型" onClick={fitModel}><Scan size={15} /></button></div></div>
      <div className="viewport-count"><span data-testid="viewport-node-count">{nodes.length} 个节点</span><span data-testid="viewport-member-count">{members.length} 根杆件</span></div>
      {!!preview?.nodes.length && <div className="viewport-preview-legend" aria-label="未应用三维方案"><span />未应用预览 · {preview.nodes.length} 节点 / {preview.members.length} 杆件 · 虚线</div>}
      {sourceLabel && <div className="viewport-case-source" aria-label="视图工况来源">{sourceLabel}</div>}
      {analysis && resultView !== "model" && <div className="viewport-result-legend" aria-label="视图结果图例"><span className={resultView === "deformation" ? "deformation-key" : "force-key"} />{resultView === "deformation" ? `变形 · ${deformationScale}×` : `${forceComponent} · ${["N", "Vy", "Vz"].includes(forceComponent) ? "kN" : "kN·m"}`}</div>}
      {selectedNode && <div className="viewport-member-details" aria-label="选中节点信息"><strong>{selectedSupport?.label ?? selectedNodalLoad?.label ?? selectedNode.label} · {selectedNode.label}</strong><span>XYZ ({selectedNode.position.x}, {selectedNode.position.y}, {selectedNode.position.z}) m</span>{selectedSupport && <span>约束 {selectedSupport.restraints.map((fixed, index) => fixed ? ["Ux", "Uy", "Uz", "Rx", "Ry", "Rz"][index] : null).filter(Boolean).join(" · ") || "无"}</span>}{selectedNodalLoad && <><span>F ({selectedNodalLoad.force.x}, {selectedNodalLoad.force.y}, {selectedNodalLoad.force.z}) kN</span><span>M ({selectedNodalLoad.moment.x}, {selectedNodalLoad.moment.y}, {selectedNodalLoad.moment.z}) kN·m</span></>}</div>}
      {selectedLoad ? <div className="viewport-member-details" data-testid="viewport-load-details"><strong>{selectedLoad.label} · {selectedMember?.label} · {selectedLoad.loadCaseId}</strong><span>{selectedLoad.coordinateSystem === "global" ? "全局 XYZ" : "杆件局部 xyz"} · q ({selectedLoad.intensity.x}, {selectedLoad.intensity.y}, {selectedLoad.intensity.z}) kN/m</span><small>整根杆件均布力</small></div> : selectedMember && selectedMaterial && selectedSection && <div className="viewport-member-details" data-testid="viewport-member-details"><strong>{selectedMember.label}</strong><span>{selectedMaterial.name} · E {selectedMaterial.elasticModulusGPa} GPa</span><span>{selectedSection.name} · A {selectedSection.areaM2} m²</span><small>分析线模型 · 截面转角 {selectedMember.rotationDegrees}°</small></div>}
      {nodes.length === 0 && !preview?.nodes.length && <div className="empty-scene"><strong>从第一个空间节点开始</strong><p>输入 X、Y、Z 坐标，节点会立即出现在统一模型中。</p></div>}
    </div>
  );
}
