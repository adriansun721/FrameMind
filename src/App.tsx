import { useMemo, useRef, useState } from "react";
import {
  Box,
  ChevronDown,
  CircleDot,
  FilePlus2,
  FolderOpen,
  Hexagon,
  Layers3,
  Plus,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { SceneViewport } from "./components/SceneViewport";
import { addNode, createProject, type FrameProject, type NodeId } from "./domain/project";
import { decodeProject, encodeProject } from "./domain/project-file";
import { captureProjectCheckpoint, isProjectCheckpointCurrent } from "./workspace/async-guards";

type StatusTone = "neutral" | "success" | "error";

interface StatusMessage {
  tone: StatusTone;
  text: string;
}

function filename(path: string | null): string | null {
  if (!path) return null;
  return path.split(/[\\/]/).pop() ?? path;
}

export function App() {
  const [project, setProject] = useState<FrameProject>(() => createProject());
  const activeProjectRef = useRef(project);
  activeProjectRef.current = project;
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [savedRevision, setSavedRevision] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<NodeId | null>(null);
  const [nodeDialogOpen, setNodeDialogOpen] = useState(false);
  const [coordinates, setCoordinates] = useState({ x: "0", y: "0", z: "0" });
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage>({
    tone: "neutral",
    text: "就绪 · 长度单位 m",
  });

  const dirty = project.revision !== savedRevision;
  const selectedNode = useMemo(
    () => project.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [project.nodes, selectedNodeId],
  );

  const activateProject = (nextProject: FrameProject) => {
    activeProjectRef.current = nextProject;
    setProject(nextProject);
  };

  const beginNewProject = () => {
    if (dirty && !window.confirm("当前项目有未保存修改，确定新建项目吗？")) return;
    activateProject(createProject());
    setProjectPath(null);
    setSavedRevision(0);
    setSelectedNodeId(null);
    setStatus({ tone: "neutral", text: "已创建空白项目" });
  };

  const openProject = async () => {
    if (dirty && !window.confirm("当前项目有未保存修改，确定打开其他项目吗？")) return;
    const checkpoint = captureProjectCheckpoint(project);
    try {
      const result = await window.frameMind.openProject();
      if (result.status === "cancelled") return;
      if (!isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, "exact")) return;
      const opened = decodeProject(result.content);
      activateProject(opened);
      setProjectPath(result.path);
      setSavedRevision(opened.revision);
      setSelectedNodeId(null);
      setStatus({ tone: "success", text: `已打开 ${filename(result.path)}` });
    } catch (error) {
      if (isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, "exact")) {
        setStatus({ tone: "error", text: error instanceof Error ? error.message : "打开项目失败" });
      }
    }
  };

  const saveProject = async () => {
    const checkpoint = captureProjectCheckpoint(project);
    try {
      const result = await window.frameMind.saveProject({
        path: projectPath,
        content: encodeProject(project),
      });
      if (result.status === "cancelled") return;
      if (!isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, "identity")) return;
      setProjectPath(result.path);
      setSavedRevision(checkpoint.revision);
      setStatus({
        tone: "success",
        text: isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, "exact")
          ? `已保存 ${filename(result.path)}`
          : `已保存 R${checkpoint.revision}，当前模型仍有未保存修改`,
      });
    } catch (error) {
      if (isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, "identity")) {
        setStatus({ tone: "error", text: error instanceof Error ? error.message : "保存项目失败，原文件未更改" });
      }
    }
  };

  const submitNode = (event: React.FormEvent) => {
    event.preventDefault();
    const position = {
      x: Number(coordinates.x),
      y: Number(coordinates.y),
      z: Number(coordinates.z),
    };
    if (
      Object.values(coordinates).some((value) => value.trim() === "") ||
      !Object.values(position).every(Number.isFinite)
    ) {
      setFormError("请输入有效的有限数值");
      return;
    }

    try {
      const updated = addNode(project, position);
      activateProject(updated);
      setSelectedNodeId(updated.nodes.at(-1)?.id ?? null);
      setNodeDialogOpen(false);
      setCoordinates({ x: "0", y: "0", z: "0" });
      setFormError(null);
      setStatus({ tone: "success", text: `已创建 ${updated.nodes.at(-1)?.label}` });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "创建节点失败");
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><Hexagon size={19} strokeWidth={1.8} /></div>
          <div>
            <span className="brand-name">FrameMind</span>
            <span className="brand-edition">STRUCTURAL STUDIO</span>
          </div>
        </div>
        <div className="document-title">
          <span>{project.name}</span>
          {dirty && <span className="dirty-dot" aria-label="未保存修改" />}
          <small>{filename(projectPath) ?? "未保存项目"}</small>
        </div>
        <div className="top-actions">
          <button className="button ghost" onClick={beginNewProject} aria-label="新建项目">
            <FilePlus2 size={16} /> 新建
          </button>
          <button className="button ghost" onClick={openProject} aria-label="打开项目">
            <FolderOpen size={16} /> 打开
          </button>
          <button className="button primary" onClick={saveProject} aria-label="保存项目">
            <Save size={16} /> 保存
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="project-panel">
          <div className="panel-heading">
            <span>项目</span>
            <button className="icon-button" title="添加节点" onClick={() => setNodeDialogOpen(true)}>
              <Plus size={16} />
            </button>
          </div>
          <div className="project-tree">
            <div className="tree-root">
              <ChevronDown size={14} />
              <Box size={15} />
              <span>{project.name}</span>
            </div>
            <div className="tree-group">
              <div className="tree-group-label">
                <ChevronDown size={13} />
                <CircleDot size={14} />
                <span>节点</span>
                <em>{project.nodes.length}</em>
              </div>
              <div className="tree-items">
                {project.nodes.map((node) => (
                  <button
                    className={`tree-item ${node.id === selectedNodeId ? "selected" : ""}`}
                    key={node.id}
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    <span className="node-glyph" />
                    <span>{node.label}</span>
                    <small>{node.position.x}, {node.position.y}, {node.position.z}</small>
                  </button>
                ))}
                {project.nodes.length === 0 && <p className="tree-empty">暂无节点</p>}
              </div>
            </div>
            {["杆件", "材料与截面", "荷载工况", "分析结果", "报告"].map((item) => (
              <div className="tree-muted" key={item}>
                <span className="chevron-placeholder">›</span>
                <Layers3 size={14} />
                <span>{item}</span>
                <em>0</em>
              </div>
            ))}
          </div>
          <div className="model-summary">
            <span>模型版本</span>
            <strong>R{project.revision}</strong>
            <small>格式 v{project.formatVersion}</small>
          </div>
        </aside>

        <section className="model-area">
          <div className="model-toolbar">
            <button className="button tool-primary" onClick={() => setNodeDialogOpen(true)} aria-label="创建节点">
              <Plus size={16} /> 创建节点
            </button>
            <span className="toolbar-divider" />
            <span className="coordinate-badge">XYZ · m</span>
          </div>
          <SceneViewport
            nodes={project.nodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        </section>

        <aside className="inspector-panel">
          <div className="panel-heading"><span>属性</span></div>
          {selectedNode ? (
            <div className="inspector-content">
              <div className="selection-title">
                <span className="selection-icon"><CircleDot size={18} /></span>
                <div><small>空间节点</small><strong>{selectedNode.label}</strong></div>
              </div>
              <section className="property-section">
                <h3>标识</h3>
                <dl>
                  <div><dt>稳定 ID</dt><dd>{selectedNode.id}</dd></div>
                  <div><dt>显示编号</dt><dd>{selectedNode.label}</dd></div>
                </dl>
              </section>
              <section className="property-section">
                <h3>全局坐标</h3>
                <dl className="coordinates-list">
                  {(["x", "y", "z"] as const).map((axis) => (
                    <div key={axis}><dt>{axis.toUpperCase()}</dt><dd>{selectedNode.position[axis].toFixed(3)} m</dd></div>
                  ))}
                </dl>
              </section>
              <p className="inspector-note">坐标来自当前已应用模型。视图与项目文件使用同一节点身份。</p>
            </div>
          ) : (
            <div className="inspector-empty">
              <CircleDot size={28} />
              <strong>未选择对象</strong>
              <p>在项目树或三维视图中选择节点以检查属性。</p>
            </div>
          )}
          <div className="ai-placeholder">
            <span><Sparkles size={15} /> AI 助手</span>
            <small>将在后续阶段接入</small>
          </div>
        </aside>
      </section>

      <footer className={`statusbar ${status.tone}`} role="status">
        <span className="status-indicator" />
        <span>{status.text}</span>
        <span className="status-spacer" />
        <span>{project.nodes.length} 节点</span>
        <span>全局坐标系 · Z 向上</span>
      </footer>

      {nodeDialogOpen && (
        <div className="dialog-backdrop" onMouseDown={() => setNodeDialogOpen(false)}>
          <section className="node-dialog" role="dialog" aria-modal="true" aria-labelledby="node-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="dialog-kicker">GEOMETRY</span><h2 id="node-dialog-title">创建空间节点</h2></div>
              <button className="icon-button" onClick={() => setNodeDialogOpen(false)} aria-label="关闭"><X size={18} /></button>
            </header>
            <p className="dialog-copy">输入全局坐标。首版长度统一以米（m）保存和显示。</p>
            <form onSubmit={submitNode}>
              <div className="coordinate-inputs">
                {(["x", "y", "z"] as const).map((axis) => (
                  <label key={axis}>
                    <span>{axis.toUpperCase()} 坐标</span>
                    <div><input type="number" step="any" value={coordinates[axis]} autoFocus={axis === "x"} onChange={(event) => setCoordinates({ ...coordinates, [axis]: event.target.value })} aria-label={`${axis.toUpperCase()} 坐标`} /><em>m</em></div>
                  </label>
                ))}
              </div>
              {formError && <p className="form-error">{formError}</p>}
              <div className="dialog-actions">
                <button type="button" className="button ghost" onClick={() => setNodeDialogOpen(false)}>取消</button>
                <button type="submit" className="button primary">添加到模型</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
