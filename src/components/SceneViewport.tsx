import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { calculateMemberGeometry } from "../domain/member-geometry";
import type { FrameMaterial, FrameMember, FrameNode, FrameSection, MemberId, NodeId } from "../domain/project";
import { calculateSceneFrame } from "./scene-camera";

export type SceneSelection = { kind: "node"; id: NodeId } | { kind: "member"; id: MemberId } | null;

interface SceneViewportProps {
  nodes: FrameNode[];
  members: FrameMember[];
  materials: FrameMaterial[];
  sections: FrameSection[];
  selection: SceneSelection;
  onSelect(selection: SceneSelection): void;
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas"); canvas.width = 192; canvas.height = 80;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgba(14, 21, 28, 0.92)"; context.beginPath(); context.roundRect(22, 10, 148, 52, 12); context.fill();
  context.strokeStyle = "rgba(153, 177, 198, 0.35)"; context.lineWidth = 2; context.stroke();
  context.font = "600 25px Inter, Segoe UI, sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
  context.fillStyle = "#e8eef3"; context.fillText(text, 96, 36);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true })); sprite.scale.set(1.8, 0.75, 1);
  return sprite;
}

export function SceneViewport({ nodes, members, materials, sections, selection, onSelect }: SceneViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null); const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const selectedMember = selection?.kind === "member" ? members.find((member) => member.id === selection.id) : undefined;
  const selectedMaterial = selectedMember ? materials.find((material) => material.id === selectedMember.materialId) : undefined;
  const selectedSection = selectedMember ? sections.find((section) => section.id === selectedMember.sectionId) : undefined;

  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#101820"); scene.fog = new THREE.Fog("#101820", 24, 55);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200); camera.up.set(0, 0, 1);
    const frame = calculateSceneFrame(nodes); camera.position.set(frame.camera.x, frame.camera.y, frame.camera.z); camera.far = frame.far; camera.updateProjectionMatrix();
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(frame.target.x, frame.target.y, frame.target.z); controls.minDistance = 2; controls.maxDistance = 70;
    const grid = new THREE.GridHelper(30, 30, "#405361", "#24333e"); grid.rotation.x = Math.PI / 2; scene.add(grid);
    const axes = new THREE.AxesHelper(2.2); axes.position.set(-0.01, -0.01, 0.02); scene.add(axes);
    scene.add(new THREE.HemisphereLight("#cfe5f5", "#17222b", 2.2));
    const light = new THREE.DirectionalLight("#ffffff", 3.4); light.position.set(8, -5, 13); scene.add(light);
    const modelGroup = new THREE.Group(); scene.add(modelGroup); const hitTargets: THREE.Object3D[] = [];

    for (const member of members) {
      const start = nodes.find((node) => node.id === member.startNodeId); const end = nodes.find((node) => node.id === member.endNodeId); if (!start || !end) continue;
      const geometry = calculateMemberGeometry(start.position, end.position, member.rotationDegrees);
      const section = sections.find((item) => item.id === member.sectionId);
      const equivalentRadius = section ? Math.max(0.055, Math.min(0.22, Math.sqrt(section.areaM2 / Math.PI))) : 0.1;
      const startVector = new THREE.Vector3(start.position.x, start.position.y, start.position.z);
      const endVector = new THREE.Vector3(end.position.x, end.position.y, end.position.z);
      const direction = endVector.clone().sub(startVector).normalize(); const selected = selection?.kind === "member" && selection.id === member.id;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(selected ? equivalentRadius + 0.03 : equivalentRadius, selected ? equivalentRadius + 0.03 : equivalentRadius, geometry.length, 14),
        new THREE.MeshStandardMaterial({ color: selected ? "#f3b64a" : "#7898aa", emissive: selected ? "#6b3d0a" : "#172b36", roughness: 0.35, metalness: 0.42 }),
      );
      mesh.position.copy(startVector).add(endVector).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      mesh.userData = { kind: "member", id: member.id }; modelGroup.add(mesh); hitTargets.push(mesh);
      const label = makeLabel(member.label); label.position.copy(mesh.position).add(new THREE.Vector3(0, 0, 0.62)); modelGroup.add(label);
      if (selected) {
        const origin = mesh.position; const size = Math.min(1.2, Math.max(0.55, geometry.length * 0.22));
        modelGroup.add(new THREE.ArrowHelper(new THREE.Vector3(geometry.localY.x, geometry.localY.y, geometry.localY.z), origin, size, "#55d790", 0.18, 0.1));
        modelGroup.add(new THREE.ArrowHelper(new THREE.Vector3(geometry.localZ.x, geometry.localZ.y, geometry.localZ.z), origin, size, "#64a8ff", 0.18, 0.1));
      }
    }

    for (const node of nodes) {
      const selected = selection?.kind === "node" && selection.id === node.id;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(selected ? 0.27 : 0.23, 28, 20),
        new THREE.MeshStandardMaterial({ color: selected ? "#f3b64a" : "#54b6d8", emissive: selected ? "#6b3d0a" : "#0b3542", emissiveIntensity: selected ? 0.65 : 0.28, roughness: 0.28, metalness: 0.2 }),
      );
      sphere.position.set(node.position.x, node.position.y, node.position.z); sphere.userData = { kind: "node", id: node.id }; modelGroup.add(sphere); hitTargets.push(sphere);
      const label = makeLabel(node.label); label.position.set(node.position.x, node.position.y, node.position.z + 0.72); modelGroup.add(label);
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(node.position.x, node.position.y, 0), new THREE.Vector3(node.position.x, node.position.y, node.position.z)]), new THREE.LineDashedMaterial({ color: "#546978", dashSize: 0.16, gapSize: 0.1 }));
      stem.computeLineDistances(); modelGroup.add(stem);
    }

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
    const selectAtPointer = (event: PointerEvent) => {
      if (event.button !== 0) return; const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1; pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(hitTargets, false)[0];
      if (!hit) onSelectRef.current(null);
      else if (hit.object.userData.kind === "node") onSelectRef.current({ kind: "node", id: String(hit.object.userData.id) as NodeId });
      else onSelectRef.current({ kind: "member", id: String(hit.object.userData.id) as MemberId });
    };
    renderer.domElement.addEventListener("pointerdown", selectAtPointer);
    const resize = () => { const { width, height } = host.getBoundingClientRect(); if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    let animationFrame = 0; const render = () => { controls.update(); renderer.render(scene, camera); animationFrame = requestAnimationFrame(render); }; render();
    return () => {
      cancelAnimationFrame(animationFrame); observer.disconnect(); renderer.domElement.removeEventListener("pointerdown", selectAtPointer); controls.dispose();
      modelGroup.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose();
        if (object instanceof THREE.Sprite) { object.material.map?.dispose(); object.material.dispose(); }
        else if (object instanceof THREE.Mesh || object instanceof THREE.Line) { if (Array.isArray(object.material)) object.material.forEach((item) => item.dispose()); else object.material.dispose(); }
      });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [nodes, members, materials, sections, selection]);

  return (
    <div className="viewport" ref={hostRef} aria-label="三维模型视图">
      <div className="viewport-topline"><span className="view-chip">透视</span><span className="view-hint">左键选择 · 右键旋转 · 滚轮缩放</span></div>
      <div className="viewport-count"><span data-testid="viewport-node-count">{nodes.length} 个节点</span><span data-testid="viewport-member-count">{members.length} 根杆件</span></div>
      {selectedMember && selectedMaterial && selectedSection && <div className="viewport-member-details" data-testid="viewport-member-details"><strong>{selectedMember.label}</strong><span>{selectedMaterial.name} · E {selectedMaterial.elasticModulusGPa} GPa</span><span>{selectedSection.name} · A {selectedSection.areaM2} m²</span><small>等效面积轮廓 · 转角 {selectedMember.rotationDegrees}°</small></div>}
      {nodes.length === 0 && <div className="empty-scene"><span className="empty-kicker">MODEL SPACE</span><strong>从第一个空间节点开始</strong><p>输入 X、Y、Z 坐标，节点会立即出现在统一模型中。</p></div>}
    </div>
  );
}
