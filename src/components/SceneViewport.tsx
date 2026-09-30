import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { FrameNode, NodeId } from "../domain/project";
import { calculateSceneFrame } from "./scene-camera";

interface SceneViewportProps {
  nodes: FrameNode[];
  selectedNodeId: NodeId | null;
  onSelectNode(id: NodeId | null): void;
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 80;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgba(14, 21, 28, 0.92)";
  context.beginPath();
  context.roundRect(22, 10, 148, 52, 12);
  context.fill();
  context.strokeStyle = "rgba(153, 177, 198, 0.35)";
  context.lineWidth = 2;
  context.stroke();
  context.font = "600 25px Inter, Segoe UI, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#e8eef3";
  context.fillText(text, 96, 36);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.8, 0.75, 1);
  return sprite;
}

export function SceneViewport({ nodes, selectedNodeId, onSelectNode }: SceneViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelectNode);
  onSelectRef.current = onSelectNode;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101820");
    scene.fog = new THREE.Fog("#101820", 24, 55);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    camera.up.set(0, 0, 1);
    const frame = calculateSceneFrame(nodes);
    camera.position.set(frame.camera.x, frame.camera.y, frame.camera.z);
    camera.far = frame.far;
    camera.updateProjectionMatrix();

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(frame.target.x, frame.target.y, frame.target.z);
    controls.minDistance = 2;
    controls.maxDistance = 70;

    const grid = new THREE.GridHelper(30, 30, "#405361", "#24333e");
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const axes = new THREE.AxesHelper(2.2);
    axes.position.set(-0.01, -0.01, 0.02);
    scene.add(axes);

    scene.add(new THREE.HemisphereLight("#cfe5f5", "#17222b", 2.2));
    const keyLight = new THREE.DirectionalLight("#ffffff", 3.4);
    keyLight.position.set(8, -5, 13);
    scene.add(keyLight);

    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);
    const hitTargets: THREE.Mesh[] = [];

    for (const node of nodes) {
      const selected = node.id === selectedNodeId;
      const material = new THREE.MeshStandardMaterial({
        color: selected ? "#f3b64a" : "#54b6d8",
        emissive: selected ? "#6b3d0a" : "#0b3542",
        emissiveIntensity: selected ? 0.65 : 0.28,
        roughness: 0.28,
        metalness: 0.2,
      });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(selected ? 0.27 : 0.23, 28, 20), material);
      sphere.position.set(node.position.x, node.position.y, node.position.z);
      sphere.userData.nodeId = node.id;
      nodeGroup.add(sphere);
      hitTargets.push(sphere);

      const label = makeLabel(node.label);
      label.position.set(node.position.x, node.position.y, node.position.z + 0.72);
      nodeGroup.add(label);

      const stem = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(node.position.x, node.position.y, 0),
          new THREE.Vector3(node.position.x, node.position.y, node.position.z),
        ]),
        new THREE.LineDashedMaterial({ color: "#546978", dashSize: 0.16, gapSize: 0.1 }),
      );
      stem.computeLineDistances();
      nodeGroup.add(stem);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const selectAtPointer = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(hitTargets, false)[0];
      onSelectRef.current(hit ? (String(hit.object.userData.nodeId) as NodeId) : null);
    };
    renderer.domElement.addEventListener("pointerdown", selectAtPointer);

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let animationFrame = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", selectAtPointer);
      controls.dispose();
      nodeGroup.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        } else if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          if (Array.isArray(object.material)) object.material.forEach((item) => item.dispose());
          else object.material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [nodes, selectedNodeId]);

  return (
    <div className="viewport" ref={hostRef} aria-label="三维模型视图">
      <div className="viewport-topline">
        <span className="view-chip">透视</span>
        <span className="view-hint">左键选择 · 右键旋转 · 滚轮缩放</span>
      </div>
      <div className="viewport-count" data-testid="viewport-node-count">
        {nodes.length} 个节点
      </div>
      {nodes.length === 0 && (
        <div className="empty-scene">
          <span className="empty-kicker">MODEL SPACE</span>
          <strong>从第一个空间节点开始</strong>
          <p>输入 X、Y、Z 坐标，节点会立即出现在统一模型中。</p>
        </div>
      )}
    </div>
  );
}
