import { useEffect, useRef } from "react";
import { Scan } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { FrameMaterial, FrameMember, FrameNode, FrameSection, MemberId, NodeId, ProjectId } from "../domain/project";
import { EngineeringSceneModel, type EngineeringScenePalette, type EngineeringSceneSelection } from "./engineering-scene-model";
import { calculateSceneFrame } from "./scene-camera";
import { disposeObjectTree } from "./three-resources";

export type SceneSelection = EngineeringSceneSelection;

interface SceneViewportProps {
  projectId: ProjectId;
  nodes: FrameNode[];
  members: FrameMember[];
  materials: FrameMaterial[];
  sections: FrameSection[];
  selection: SceneSelection;
  onSelect(selection: SceneSelection): void;
}

interface ScenePalette extends EngineeringScenePalette {
  canvas: string;
  gridMajor: string;
  gridMinor: string;
  axisX: string;
  labelSurface: string;
  labelBorder: string;
  labelText: string;
}

interface SceneRuntime {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  model: EngineeringSceneModel;
  renderer: THREE.WebGLRenderer;
  projectId: ProjectId | null;
  hasFramedModel: boolean;
}

function readScenePalette(): ScenePalette {
  const styles = getComputedStyle(document.documentElement);
  const color = (token: string) => styles.getPropertyValue(token).trim();
  return {
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.62, 0.23, 1); sprite.renderOrder = 3;
  return sprite;
}

function applySceneFrame(camera: THREE.PerspectiveCamera, controls: OrbitControls, nodes: FrameNode[]): void {
  const frame = calculateSceneFrame(nodes);
  camera.position.set(frame.camera.x, frame.camera.y, frame.camera.z);
  camera.far = frame.far;
  camera.updateProjectionMatrix();
  controls.target.set(frame.target.x, frame.target.y, frame.target.z);
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

export function SceneViewport({ projectId, nodes, members, materials, sections, selection, onSelect }: SceneViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const selectedMember = selection?.kind === "member" ? members.find((member) => member.id === selection.id) : undefined;
  const selectedMaterial = selectedMember ? materials.find((material) => material.id === selectedMember.materialId) : undefined;
  const selectedSection = selectedMember ? sections.find((section) => section.id === selectedMember.sectionId) : undefined;

  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    const palette = readScenePalette();
    const scene = new THREE.Scene(); scene.background = new THREE.Color(palette.canvas); scene.fog = new THREE.Fog(palette.canvas, 24, 55);
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
    const model = new EngineeringSceneModel(modelGroup, palette, (text) => makeLabel(text, palette));
    runtimeRef.current = { camera, controls, model, renderer, projectId: null, hasFramedModel: false };

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let pointerStart: THREE.Vector2 | null = null;
    const hitAtPointer = (event: PointerEvent): THREE.Intersection | undefined => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1; pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(model.getHitTargets(), false)[0];
    };
    const beginPointer = (event: PointerEvent) => { if (event.button === 0) pointerStart = new THREE.Vector2(event.clientX, event.clientY); };
    const finishPointer = (event: PointerEvent) => {
      if (event.button !== 0 || !pointerStart) return;
      const moved = pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)); pointerStart = null;
      if (moved > 4) return;
      const hit = hitAtPointer(event); onSelectRef.current(hit ? selectionFromHit(hit) : null);
    };
    const hoverPointer = (event: PointerEvent) => {
      if (event.buttons !== 0) { model.setHover(null); return; }
      const hit = hitAtPointer(event); model.setHover(hit ? selectionFromHit(hit) : null);
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

  useEffect(() => { runtimeRef.current?.model.setSelection(selection); }, [selection, nodes, members]);

  const fitModel = () => {
    const runtime = runtimeRef.current;
    if (runtime) applySceneFrame(runtime.camera, runtime.controls, nodes);
  };

  return (
    <div className="viewport" ref={hostRef} aria-label="三维模型视图">
      <div className="viewport-topline"><span className="view-chip">分析线 · 透视</span><div className="viewport-tools"><span className="view-hint">单击选择 · 拖动旋转 · 滚轮缩放</span><button className="icon-button" aria-label="适合模型" title="适合模型" onClick={fitModel}><Scan size={15} /></button></div></div>
      <div className="viewport-count"><span data-testid="viewport-node-count">{nodes.length} 个节点</span><span data-testid="viewport-member-count">{members.length} 根杆件</span></div>
      {selectedMember && selectedMaterial && selectedSection && <div className="viewport-member-details" data-testid="viewport-member-details"><strong>{selectedMember.label}</strong><span>{selectedMaterial.name} · E {selectedMaterial.elasticModulusGPa} GPa</span><span>{selectedSection.name} · A {selectedSection.areaM2} m²</span><small>分析线模型 · 截面转角 {selectedMember.rotationDegrees}°</small></div>}
      {nodes.length === 0 && <div className="empty-scene"><strong>从第一个空间节点开始</strong><p>输入 X、Y、Z 坐标，节点会立即出现在统一模型中。</p></div>}
    </div>
  );
}
