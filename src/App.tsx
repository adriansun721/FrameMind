import { useEffect, useMemo, useRef, useState } from "react";
import { Anchor, Box, Calculator, ChevronDown, CircleDot, FilePlus2, FolderOpen, Hexagon, Layers3, Link2, MousePointer2, Plus, Redo2, Save, Undo2, X } from "lucide-react";
import { SceneViewport, type SceneSelection } from "./components/SceneViewport";
import { calculateMemberGeometry } from "./domain/member-geometry";
import {
  addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, attachAnalysisResult, createProject, updateMaterial, updateMember, updateNode, updateSection,
  type DofRestraints, type FrameProject, type MaterialId, type NodeId, type SectionId,
} from "./domain/project";
import { captureAnalysisInput, solveFrame, type AnalysisResult } from "./domain/analysis";
import { decodeProject, encodeProject } from "./domain/project-file";
import { captureProjectCheckpoint, isProjectCheckpointCurrent } from "./workspace/async-guards";

type StatusTone = "neutral" | "success" | "error";
type Selection = SceneSelection | { kind: "material"; id: MaterialId } | { kind: "section"; id: SectionId };
interface StatusMessage { tone: StatusTone; text: string; }
interface NodeDraft { x: string; y: string; z: string; }
interface MaterialDraft { name: string; elasticModulusGPa: string; poissonRatio: string; densityKgM3: string; }
interface SectionDraft { name: string; areaM2: string; secondMomentYM4: string; secondMomentZM4: string; torsionalConstantM4: string; }
interface MemberDraft { startNodeId: string; endNodeId: string; materialId: string; sectionId: string; rotationDegrees: string; }
interface LoadDraft { nodeId: string; fx: string; fy: string; fz: string; mx: string; my: string; mz: string; }

const defaultMaterial: MaterialDraft = { name: "Q355", elasticModulusGPa: "206", poissonRatio: "0.3", densityKgM3: "7850" };
const defaultSection: SectionDraft = { name: "箱形截面", areaM2: "0.01", secondMomentYM4: "0.0001", secondMomentZM4: "0.0001", torsionalConstantM4: "0.00015" };
const defaultLoad: LoadDraft = { nodeId: "", fx: "0", fy: "0", fz: "0", mx: "0", my: "0", mz: "0" };
const parseNumber = (value: string, label: string) => {
  if (!value.trim()) throw new Error(`${label}不能为空`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须是有限数值`);
  return parsed;
};
const materialToNumbers = (draft: MaterialDraft) => ({ name: draft.name, elasticModulusGPa: parseNumber(draft.elasticModulusGPa, "弹性模量 E"), poissonRatio: parseNumber(draft.poissonRatio, "泊松比 ν"), densityKgM3: parseNumber(draft.densityKgM3, "密度 ρ") });
const sectionToNumbers = (draft: SectionDraft) => ({ name: draft.name, areaM2: parseNumber(draft.areaM2, "面积 A"), secondMomentYM4: parseNumber(draft.secondMomentYM4, "惯性矩 Iy"), secondMomentZM4: parseNumber(draft.secondMomentZM4, "惯性矩 Iz"), torsionalConstantM4: parseNumber(draft.torsionalConstantM4, "扭转常数 J") });
const filename = (path: string | null) => path ? path.split(/[\\/]/).pop() ?? path : null;
const vectorText = (vector: { x: number; y: number; z: number }) => `(${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)})`;

export function App() {
  const [project, setProject] = useState<FrameProject>(() => createProject());
  const activeProjectRef = useRef(project); const activeSessionRef = useRef(0); activeProjectRef.current = project;
  const [projectPath, setProjectPath] = useState<string | null>(null); const [savedRevision, setSavedRevision] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [nodeDialogOpen, setNodeDialogOpen] = useState(false); const [resourceDialogOpen, setResourceDialogOpen] = useState(false); const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false); const [loadDialogOpen, setLoadDialogOpen] = useState(false); const [analysisBusy, setAnalysisBusy] = useState(false);
  const [nodeDraft, setNodeDraft] = useState<NodeDraft>({ x: "0", y: "0", z: "0" });
  const [materialDraft, setMaterialDraft] = useState<MaterialDraft>(defaultMaterial); const [sectionDraft, setSectionDraft] = useState<SectionDraft>(defaultSection);
  const [memberDraft, setMemberDraft] = useState<MemberDraft>({ startNodeId: "", endNodeId: "", materialId: "", sectionId: "", rotationDegrees: "0" });
  const [supportNodeId, setSupportNodeId] = useState(""); const [supportRestraints, setSupportRestraints] = useState<DofRestraints>([true, true, true, true, true, true]);
  const [loadDraft, setLoadDraft] = useState<LoadDraft>(defaultLoad);
  const [formError, setFormError] = useState<string | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [status, setStatus] = useState<StatusMessage>({ tone: "neutral", text: "就绪" });
  const dirty = project.revision !== savedRevision;
  const memberCreationAvailable = project.nodes.length >= 2 && project.materials.length > 0 && project.sections.length > 0;
  const analysisAvailable = project.members.length > 0 && project.supports.length > 0 && project.nodalLoads.length > 0;

  const selectedNode = selection?.kind === "node" ? project.nodes.find((item) => item.id === selection.id) ?? null : null;
  const selectedMember = selection?.kind === "member" ? project.members.find((item) => item.id === selection.id) ?? null : null;
  const selectedMaterial = selection?.kind === "material" ? project.materials.find((item) => item.id === selection.id) ?? null : null;
  const selectedSection = selection?.kind === "section" ? project.sections.find((item) => item.id === selection.id) ?? null : null;
  const currentSelectionLabel = selectedNode?.label ?? selectedMember?.label ?? selectedMaterial?.label ?? selectedSection?.label ?? "无选择";
  const memberGeometry = useMemo(() => {
    if (!selectedMember) return null;
    const start = project.nodes.find((item) => item.id === selectedMember.startNodeId); const end = project.nodes.find((item) => item.id === selectedMember.endNodeId);
    return start && end ? calculateMemberGeometry(start.position, end.position, selectedMember.rotationDegrees) : null;
  }, [project.nodes, selectedMember]);

  const activateProject = (next: FrameProject, newSession: boolean) => { if (newSession) activeSessionRef.current += 1; activeProjectRef.current = next; setProject(next); };
  const selectObject = (next: Selection) => {
    setSelection(next); setFormError(null); if (!next) return;
    if (next.kind === "node") { const item = project.nodes.find((node) => node.id === next.id); if (item) setNodeDraft({ x: String(item.position.x), y: String(item.position.y), z: String(item.position.z) }); }
    if (next.kind === "member") { const item = project.members.find((member) => member.id === next.id); if (item) setMemberDraft({ startNodeId: item.startNodeId, endNodeId: item.endNodeId, materialId: item.materialId, sectionId: item.sectionId, rotationDegrees: String(item.rotationDegrees) }); }
    if (next.kind === "material") { const item = project.materials.find((material) => material.id === next.id); if (item) setMaterialDraft({ name: item.name, elasticModulusGPa: String(item.elasticModulusGPa), poissonRatio: String(item.poissonRatio), densityKgM3: String(item.densityKgM3) }); }
    if (next.kind === "section") { const item = project.sections.find((section) => section.id === next.id); if (item) setSectionDraft({ name: item.name, areaM2: String(item.areaM2), secondMomentYM4: String(item.secondMomentYM4), secondMomentZM4: String(item.secondMomentZM4), torsionalConstantM4: String(item.torsionalConstantM4) }); }
  };

  const beginNewProject = () => { if (dirty && !window.confirm("当前项目有未保存修改，确定新建项目吗？")) return; activateProject(createProject(), true); setProjectPath(null); setSavedRevision(0); setSelection(null); setStatus({ tone: "neutral", text: "已创建空白项目" }); };
  const openProject = async () => {
    if (dirty && !window.confirm("当前项目有未保存修改，确定打开其他项目吗？")) return;
    const checkpoint = captureProjectCheckpoint(project, activeSessionRef.current);
    try {
      const result = await window.frameMind.openProject(); if (result.status === "cancelled" || !isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "exact")) return;
      const opened = decodeProject(result.content); activateProject(opened, true); setProjectPath(result.path); setSavedRevision(opened.revision); setSelection(null); setStatus({ tone: "success", text: `已打开 ${filename(result.path)}` });
    } catch (error) { if (isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "exact")) setStatus({ tone: "error", text: error instanceof Error ? error.message : "打开项目失败" }); }
  };
  const saveProject = async () => {
    const checkpoint = captureProjectCheckpoint(project, activeSessionRef.current);
    try {
      const result = await window.frameMind.saveProject({ path: projectPath, content: encodeProject(project) }); if (result.status === "cancelled" || !isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "identity")) return;
      setProjectPath(result.path); setSavedRevision(checkpoint.revision); setStatus({ tone: "success", text: isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "exact") ? `已保存 ${filename(result.path)}` : `已保存 R${checkpoint.revision}，当前模型仍有未保存修改` });
    } catch (error) { if (isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "identity")) setStatus({ tone: "error", text: error instanceof Error ? error.message : "保存项目失败，原文件未更改" }); }
  };

  const submitNode = (event: React.FormEvent) => {
    event.preventDefault(); const position = { x: Number(nodeDraft.x), y: Number(nodeDraft.y), z: Number(nodeDraft.z) };
    if (Object.values(nodeDraft).some((value) => value.trim() === "") || !Object.values(position).every(Number.isFinite)) { setFormError("请输入有效的有限数值"); return; }
    try { const updated = addNode(project, position); activateProject(updated, false); const node = updated.nodes.at(-1)!; setSelection({ kind: "node", id: node.id }); setNodeDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: `已创建 ${node.label}` }); }
    catch (error) { setFormError(error instanceof Error ? error.message : "创建节点失败"); }
  };
  const submitResources = (event: React.FormEvent) => {
    event.preventDefault();
    try { let updated = addMaterial(project, materialToNumbers(materialDraft)); updated = addSection(updated, sectionToNumbers(sectionDraft)); activateProject(updated, false); setResourceDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: `已创建材料 ${updated.materials.at(-1)!.label} 与截面 ${updated.sections.at(-1)!.label}` }); }
    catch (error) { setFormError(error instanceof Error ? error.message : "创建材料与截面失败"); }
  };
  const openMemberDialog = () => {
    setMemberDraft({ startNodeId: project.nodes[0]?.id ?? "", endNodeId: project.nodes[1]?.id ?? project.nodes[0]?.id ?? "", materialId: project.materials[0]?.id ?? "", sectionId: project.sections[0]?.id ?? "", rotationDegrees: "0" }); setFormError(null); setMemberDialogOpen(true);
  };
  const openSupportDialog = () => { setSupportNodeId(project.nodes[0]?.id ?? ""); setSupportRestraints([true, true, true, true, true, true]); setFormError(null); setSupportDialogOpen(true); };
  const openLoadDialog = () => { setLoadDraft({ ...defaultLoad, nodeId: project.nodes.at(-1)?.id ?? project.nodes[0]?.id ?? "" }); setFormError(null); setLoadDialogOpen(true); };
  const openNodeDialog = () => { setNodeDraft({ x: "0", y: "0", z: "0" }); setFormError(null); setNodeDialogOpen(true); };
  const submitMember = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const updated = addMember(project, { startNodeId: memberDraft.startNodeId as NodeId, endNodeId: memberDraft.endNodeId as NodeId, materialId: memberDraft.materialId as MaterialId, sectionId: memberDraft.sectionId as SectionId, rotationDegrees: parseNumber(memberDraft.rotationDegrees, "截面转角") });
      activateProject(updated, false); const member = updated.members.at(-1)!; setSelection({ kind: "member", id: member.id }); setMemberDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: `已创建 ${member.label}` });
    } catch (error) { setFormError(error instanceof Error ? error.message : "创建杆件失败"); }
  };
  const submitSupport = (event: React.FormEvent) => {
    event.preventDefault();
    try { const updated = addSupport(project, supportNodeId as NodeId, supportRestraints); activateProject(updated, false); setSupportDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: `已创建固定支座 ${updated.supports.at(-1)!.label}` }); }
    catch (error) { setFormError(error instanceof Error ? error.message : "创建支座失败"); }
  };
  const submitLoad = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const vector = (x: string, y: string, z: string, name: string) => ({ x: parseNumber(x, `${name} X`), y: parseNumber(y, `${name} Y`), z: parseNumber(z, `${name} Z`) });
      const updated = addNodalLoad(project, loadDraft.nodeId as NodeId, vector(loadDraft.fx, loadDraft.fy, loadDraft.fz, "节点力"), vector(loadDraft.mx, loadDraft.my, loadDraft.mz, "节点力矩"));
      activateProject(updated, false); setLoadDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: `已创建节点荷载 ${updated.nodalLoads.at(-1)!.label}` });
    } catch (error) { setFormError(error instanceof Error ? error.message : "创建节点荷载失败"); }
  };
  const runAnalysis = async () => {
    if (analysisBusy || !analysisAvailable) { if (!analysisAvailable) setStatus({ tone: "error", text: "请先创建杆件、支座和节点荷载" }); return; }
    const inputProject = captureAnalysisInput(project); const checkpoint = captureProjectCheckpoint(project, activeSessionRef.current); setAnalysisBusy(true); setStatus({ tone: "neutral", text: "正在组装刚度矩阵并求解…" });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    try {
      const result = solveFrame(inputProject);
      if (!isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "exact")) return;
      const updated = attachAnalysisResult(activeProjectRef.current, result); activateProject(updated, false); setSelection(null); setStatus({ tone: "success", text: `分析完成 · ${result.nodes.length} 个节点结果，${result.members.length} 根杆件结果` });
    } catch (error) { if (isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "exact")) setStatus({ tone: "error", text: error instanceof Error ? error.message : "分析失败" }); }
    finally { setAnalysisBusy(false); }
  };

  const saveNodeEdit = (event: React.FormEvent) => { event.preventDefault(); if (!selectedNode) return; try { const updated = updateNode(project, selectedNode.id, { x: parseNumber(nodeDraft.x, "X 坐标"), y: parseNumber(nodeDraft.y, "Y 坐标"), z: parseNumber(nodeDraft.z, "Z 坐标") }); activateProject(updated, false); setStatus({ tone: "success", text: `已更新 ${selectedNode.label}` }); setFormError(null); } catch (error) { setFormError(error instanceof Error ? error.message : "更新节点失败"); } };
  const saveMemberEdit = (event: React.FormEvent) => { event.preventDefault(); if (!selectedMember) return; try { const updated = updateMember(project, selectedMember.id, { startNodeId: memberDraft.startNodeId as NodeId, endNodeId: memberDraft.endNodeId as NodeId, materialId: memberDraft.materialId as MaterialId, sectionId: memberDraft.sectionId as SectionId, rotationDegrees: parseNumber(memberDraft.rotationDegrees, "截面转角") }); activateProject(updated, false); setStatus({ tone: "success", text: `已更新 ${selectedMember.label}` }); setFormError(null); } catch (error) { setFormError(error instanceof Error ? error.message : "更新杆件失败"); } };
  const saveMaterialEdit = (event: React.FormEvent) => { event.preventDefault(); if (!selectedMaterial) return; try { const updated = updateMaterial(project, selectedMaterial.id, materialToNumbers(materialDraft)); activateProject(updated, false); setStatus({ tone: "success", text: `已更新材料 ${selectedMaterial.label}` }); setFormError(null); } catch (error) { setFormError(error instanceof Error ? error.message : "更新材料失败"); } };
  const saveSectionEdit = (event: React.FormEvent) => { event.preventDefault(); if (!selectedSection) return; try { const updated = updateSection(project, selectedSection.id, sectionToNumbers(sectionDraft)); activateProject(updated, false); setStatus({ tone: "success", text: `已更新截面 ${selectedSection.label}` }); setFormError(null); } catch (error) { setFormError(error instanceof Error ? error.message : "更新截面失败"); } };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setFileMenuOpen(false); return; }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (!["n", "o", "s"].includes(key)) return;
      event.preventDefault();
      setFileMenuOpen(false);
      if (key === "n") beginNewProject();
      if (key === "o") void openProject();
      if (key === "s") void saveProject();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-and-file">
        <div className="brand-block"><div className="brand-mark"><Hexagon size={15} strokeWidth={1.5} /></div><span className="brand-name">FrameMind</span></div>
        <div className="file-menu-container" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFileMenuOpen(false); }}>
          <button className="file-menu-trigger" aria-label="文件" aria-haspopup="menu" aria-expanded={fileMenuOpen} onClick={() => setFileMenuOpen((open) => !open)}>文件<ChevronDown size={14} /></button>
          {fileMenuOpen && <div className="file-menu" role="menu" aria-label="文件">
            <MenuAction icon={<FilePlus2 size={14} />} label="新建项目" shortcut="Ctrl+N" onSelect={() => { setFileMenuOpen(false); beginNewProject(); }} />
            <MenuAction icon={<FolderOpen size={14} />} label="打开项目" shortcut="Ctrl+O" onSelect={() => { setFileMenuOpen(false); void openProject(); }} />
            <MenuAction icon={<Save size={14} />} label="保存项目" shortcut="Ctrl+S" onSelect={() => { setFileMenuOpen(false); void saveProject(); }} />
          </div>}
        </div>
      </div>
      <div className="document-title"><span>{project.name}</span>{dirty && <span className="dirty-dot" aria-label="未保存修改" />}<small>{filename(projectPath) ?? "未保存项目"}</small></div>
      <nav className="task-tabs" role="tablist" aria-label="工作任务">
        <button className="task-tab active" role="tab" aria-selected="true">建模</button>
        {(["荷载", "分析", "结果"] as const).map((task) => <button className="task-tab" role="tab" aria-selected="false" disabled title={`${task}请使用当前任务工具`} key={task}>{task}</button>)}
      </nav>
    </header>

    <section className="task-toolbar" aria-label="当前任务工具">
      <span className="task-context">建模</span><span className="toolbar-divider" />
      <div className="model-toolbar" role="toolbar" aria-label="建模工具">
        <button className="tool-button active" aria-label="选择" aria-pressed="true" title="选择对象" onClick={() => selectObject(null)}><MousePointer2 size={15} />选择</button>
        <button className="tool-button" onClick={openNodeDialog} aria-label="创建节点" title="创建节点"><CircleDot size={15} />节点</button>
        <button className="tool-button" aria-disabled={!memberCreationAvailable} onClick={memberCreationAvailable ? openMemberDialog : undefined} aria-label="创建杆件" title={memberCreationAvailable ? "创建杆件" : "需要至少两个节点、一个材料和一个截面"}><Link2 size={15} />杆件</button>
        <button className="tool-button" onClick={() => { setMaterialDraft(defaultMaterial); setSectionDraft(defaultSection); setFormError(null); setResourceDialogOpen(true); }} aria-label="创建材料与截面" title="创建材料与截面"><Layers3 size={15} />材料与截面</button>
        <button className="tool-button" aria-disabled="true" aria-label="支座（尚未实现）" title="基础工具栏占位；使用设置支座打开 T03 支座输入"><Anchor size={15} />支座</button>
        <button className="tool-button" aria-label="设置支座" title="创建节点支座" onClick={openSupportDialog}><Anchor size={15} />设置支座</button>
        <button className="tool-button" aria-label="创建荷载" title="创建节点集中力和力矩" onClick={openLoadDialog}><Plus size={15} />荷载</button>
        <button className="tool-button" aria-label="运行分析" title={analysisAvailable ? "运行空间刚架静力分析" : "需要杆件、支座和节点荷载"} aria-disabled={!analysisAvailable || analysisBusy} onClick={() => void runAnalysis()}><Calculator size={15} />{analysisBusy ? "计算中" : "计算"}</button>
        <span className="toolbar-divider" />
        <button className="tool-button icon-only" aria-disabled="true" aria-label="撤销（尚未实现）" title="撤销尚未实现"><Undo2 size={15} /></button>
        <button className="tool-button icon-only" aria-disabled="true" aria-label="重做（尚未实现）" title="重做尚未实现"><Redo2 size={15} /></button>
      </div>
    </section>

    <section className="workspace">
      <aside className="project-panel" aria-label="项目与属性">
        <section className="sidebar-pane project-tree-pane" aria-label="项目树"><div className="panel-heading"><span>项目</span><button className="icon-button" title="添加节点" onClick={openNodeDialog}><Plus size={16} /></button></div>
          <div className="project-tree"><div className="tree-root"><ChevronDown size={14} /><Box size={15} /><span>{project.name}</span></div>
          <TreeGroup label="节点" count={project.nodes.length} icon={<CircleDot size={14} />}>
            {project.nodes.map((node) => <button className={`tree-item ${selection?.kind === "node" && selection.id === node.id ? "selected" : ""}`} key={node.id} onClick={() => selectObject({ kind: "node", id: node.id })}><span className="node-glyph" /><span>{node.label}</span><small>{node.position.x}, {node.position.y}, {node.position.z}</small></button>)}
            {project.nodes.length === 0 && <p className="tree-empty">暂无节点</p>}
          </TreeGroup>
          <TreeGroup label="杆件" count={project.members.length} icon={<Link2 size={14} />}>
            {project.members.map((member) => <button className={`tree-item ${selection?.kind === "member" && selection.id === member.id ? "selected" : ""}`} key={member.id} onClick={() => selectObject({ kind: "member", id: member.id })}><span className="member-glyph" /><span>{member.label}</span><small>{member.startNodeId.replace("node_", "N")} → {member.endNodeId.replace("node_", "N")}</small></button>)}
            {project.members.length === 0 && <p className="tree-empty">暂无杆件</p>}
          </TreeGroup>
          <TreeGroup label="材料与截面" count={project.materials.length + project.sections.length} icon={<Layers3 size={14} />}>
            {project.materials.map((material) => <button className={`tree-item resource ${selection?.kind === "material" && selection.id === material.id ? "selected" : ""}`} key={material.id} onClick={() => selectObject({ kind: "material", id: material.id })}><span className="material-glyph" /><span>材料 {material.label} · {material.name}</span></button>)}
            {project.sections.map((section) => <button className={`tree-item resource ${selection?.kind === "section" && selection.id === section.id ? "selected" : ""}`} key={section.id} onClick={() => selectObject({ kind: "section", id: section.id })}><span className="section-glyph" /><span>截面 {section.label} · {section.name}</span></button>)}
          </TreeGroup>
          <TreeGroup label="支座" count={project.supports.length} icon={<Anchor size={14} />}>
            {project.supports.map((support) => <button className="tree-item resource" key={support.id} onClick={() => setSelection(null)}><span className="material-glyph" /><span>{support.label} · {project.nodes.find((node) => node.id === support.nodeId)?.label ?? support.nodeId}</span></button>)}
            {project.supports.length === 0 && <p className="tree-empty">暂无支座</p>}
          </TreeGroup>
          <TreeGroup label="节点荷载" count={project.nodalLoads.length} icon={<Plus size={14} />}>
            {project.nodalLoads.map((load) => <button className="tree-item resource" key={load.id} onClick={() => setSelection(null)}><span className="section-glyph" /><span>{load.label} · {project.nodes.find((node) => node.id === load.nodeId)?.label ?? load.nodeId}</span></button>)}
            {project.nodalLoads.length === 0 && <p className="tree-empty">暂无节点荷载</p>}
          </TreeGroup>
          <button className={`tree-item ${project.latestAnalysis && !selection ? "selected" : ""}`} aria-label="查看分析结果" disabled={!project.latestAnalysis} onClick={() => selectObject(null)}><Calculator size={14} /><span>分析结果</span><small>{project.latestAnalysis?.nodes.length ?? 0}</small></button>
          <div className="tree-muted"><span className="chevron-placeholder">›</span><Layers3 size={14} /><span>报告</span><em>0</em></div>
          </div><div className="model-summary"><span>模型版本</span><strong>R{project.revision}</strong><small>格式 v{project.formatVersion}</small></div>
        </section>
        <div className="sidebar-divider" role="separator" aria-orientation="horizontal" />
        <section className="sidebar-pane property-pane" aria-label="对象属性"><div className="panel-heading"><span>属性</span></div>
          {selectedNode && <Inspector title="空间节点" label={selectedNode.label} icon={<CircleDot size={15} />}>
            <Identity id={selectedNode.id} label={selectedNode.label} />
            <section className="property-section"><h3>当前全局坐标</h3><dl className="coordinates-list">{(["x", "y", "z"] as const).map((axis) => <div key={axis}><dt>{axis.toUpperCase()}</dt><dd>{selectedNode.position[axis].toFixed(3)} m</dd></div>)}</dl></section>
            <form className="property-form" onSubmit={saveNodeEdit}><h3>全局坐标</h3>{(["x", "y", "z"] as const).map((axis) => <NumberField key={axis} label={`${axis.toUpperCase()} 坐标`} value={nodeDraft[axis]} onChange={(value) => setNodeDraft({ ...nodeDraft, [axis]: value })} unit="m" />)}<FormFeedback error={formError} /><button className="button primary" type="submit">保存节点属性</button></form>
          </Inspector>}
          {selectedMember && memberGeometry && <Inspector title="空间刚架杆件" label={selectedMember.label} icon={<Link2 size={15} />}>
            <Identity id={selectedMember.id} label={selectedMember.label} />
            <section className="property-section"><h3>几何与局部轴</h3><dl><div><dt>长度</dt><dd>{memberGeometry.length.toFixed(3)} m</dd></div><div><dt>局部 x</dt><dd>{vectorText(memberGeometry.localX)}</dd></div><div><dt>局部 y</dt><dd>{vectorText(memberGeometry.localY)}</dd></div><div><dt>局部 z</dt><dd>{vectorText(memberGeometry.localZ)}</dd></div><div><dt>参考轴</dt><dd>{memberGeometry.referenceAxis === "global-z" ? "全局 Z" : "全局 Y（竖杆回退）"}</dd></div></dl></section>
            <form className="property-form" onSubmit={saveMemberEdit}><h3>连接与朝向</h3><SelectField label="起点节点" value={memberDraft.startNodeId} onChange={(value) => setMemberDraft({ ...memberDraft, startNodeId: value })} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><SelectField label="终点节点" value={memberDraft.endNodeId} onChange={(value) => setMemberDraft({ ...memberDraft, endNodeId: value })} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><SelectField label="材料" value={memberDraft.materialId} onChange={(value) => setMemberDraft({ ...memberDraft, materialId: value })} options={project.materials.map((item) => ({ value: item.id, label: `${item.label} · ${item.name}` }))} /><SelectField label="截面" value={memberDraft.sectionId} onChange={(value) => setMemberDraft({ ...memberDraft, sectionId: value })} options={project.sections.map((item) => ({ value: item.id, label: `${item.label} · ${item.name}` }))} /><NumberField label="截面转角（°）" value={memberDraft.rotationDegrees} onChange={(value) => setMemberDraft({ ...memberDraft, rotationDegrees: value })} unit="°" /><div className="assignment-summary"><span>{project.materials.find((item) => item.id === selectedMember.materialId)?.name}</span><span>{project.sections.find((item) => item.id === selectedMember.sectionId)?.name}</span></div><FormFeedback error={formError} /><button className="button primary" type="submit">保存杆件属性</button></form>
          </Inspector>}
          {selectedMaterial && <Inspector title="自定义材料" label={`${selectedMaterial.label} · ${selectedMaterial.name}`} icon={<Layers3 size={15} />}><Identity id={selectedMaterial.id} label={selectedMaterial.label} /><MaterialFields draft={materialDraft} setDraft={setMaterialDraft} /><FormFeedback error={formError} /><button className="button primary inspector-save" onClick={(event) => void saveMaterialEdit(event)}>保存材料属性</button></Inspector>}
          {selectedSection && <Inspector title="自定义截面" label={`${selectedSection.label} · ${selectedSection.name}`} icon={<Box size={15} />}><Identity id={selectedSection.id} label={selectedSection.label} /><SectionFields draft={sectionDraft} setDraft={setSectionDraft} /><FormFeedback error={formError} /><button className="button primary inspector-save" onClick={(event) => void saveSectionEdit(event)}>保存截面属性</button></Inspector>}
          {project.latestAnalysis && !selectedNode && !selectedMember && !selectedMaterial && !selectedSection && <AnalysisResultPanel result={project.latestAnalysis} project={project} />}
          {!selectedNode && !selectedMember && !selectedMaterial && !selectedSection && !project.latestAnalysis && <div className="inspector-empty"><strong>未选择对象</strong><p>从项目树或三维视图选择对象以编辑属性。</p></div>}
        </section>
      </aside>

      <section className="model-area"><SceneViewport projectId={project.id} nodes={project.nodes} members={project.members} materials={project.materials} sections={project.sections} selection={selection?.kind === "node" || selection?.kind === "member" ? selection : null} onSelect={selectObject} /></section>

    </section>

    <footer className={`statusbar ${status.tone}`} role="status"><span className="status-indicator" /><span>{status.text}</span><span className="status-spacer" /><span>当前选择 {currentSelectionLabel}</span><span>{project.nodes.length} 节点</span><span>{project.members.length} 杆件</span><span>长度 m</span><span>全局坐标系 · Z 向上</span></footer>

    {nodeDialogOpen && <Dialog title="创建空间节点" copy="输入全局坐标。长度统一以米（m）保存和显示。" onClose={() => setNodeDialogOpen(false)}><form onSubmit={submitNode}><div className="coordinate-inputs">{(["x", "y", "z"] as const).map((axis) => <NumberField key={axis} label={`${axis.toUpperCase()} 坐标`} value={nodeDraft[axis]} onChange={(value) => setNodeDraft({ ...nodeDraft, [axis]: value })} unit="m" />)}</div><FormFeedback error={formError} /><DialogActions close={() => setNodeDialogOpen(false)} submit="添加到模型" /></form></Dialog>}
    {resourceDialogOpen && <Dialog title="创建材料与截面" copy="参数使用 SI 基准单位；这些值将在 T03 核定单元理论前保持明确含义。" onClose={() => setResourceDialogOpen(false)}><form onSubmit={submitResources}><div className="resource-columns"><MaterialFields draft={materialDraft} setDraft={setMaterialDraft} /><SectionFields draft={sectionDraft} setDraft={setSectionDraft} /></div><FormFeedback error={formError} /><DialogActions close={() => setResourceDialogOpen(false)} submit="保存材料与截面" /></form></Dialog>}
    {memberDialogOpen && <Dialog title="连接空间杆件" copy="选择两个不同位置的节点，并指定材料、截面和绕局部 x 轴的截面转角。" onClose={() => setMemberDialogOpen(false)}><form onSubmit={submitMember}><div className="form-grid"><SelectField label="起点节点" value={memberDraft.startNodeId} onChange={(value) => setMemberDraft({ ...memberDraft, startNodeId: value })} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><SelectField label="终点节点" value={memberDraft.endNodeId} onChange={(value) => setMemberDraft({ ...memberDraft, endNodeId: value })} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><SelectField label="材料" value={memberDraft.materialId} onChange={(value) => setMemberDraft({ ...memberDraft, materialId: value })} options={project.materials.map((item) => ({ value: item.id, label: `${item.label} · ${item.name}` }))} /><SelectField label="截面" value={memberDraft.sectionId} onChange={(value) => setMemberDraft({ ...memberDraft, sectionId: value })} options={project.sections.map((item) => ({ value: item.id, label: `${item.label} · ${item.name}` }))} /><NumberField label="截面转角（°）" value={memberDraft.rotationDegrees} onChange={(value) => setMemberDraft({ ...memberDraft, rotationDegrees: value })} unit="°" /></div><FormFeedback error={formError} /><DialogActions close={() => setMemberDialogOpen(false)} submit="添加杆件" /></form></Dialog>}
    {supportDialogOpen && <Dialog title="创建节点支座" copy="支座独立约束节点的六个自由度。固定支座默认约束平移与转动全部分量。" onClose={() => setSupportDialogOpen(false)}><form onSubmit={submitSupport}><SelectField label="约束节点" value={supportNodeId} onChange={setSupportNodeId} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><fieldset className="resource-fieldset"><legend>约束自由度</legend><div className="restraint-grid">{(["UX 平移", "UY 平移", "UZ 平移", "RX 转动", "RY 转动", "RZ 转动"] as const).map((label, index) => <label className="check-field" key={label}><input type="checkbox" checked={supportRestraints[index]} onChange={(event) => setSupportRestraints(supportRestraints.map((value, itemIndex) => itemIndex === index ? event.target.checked : value) as DofRestraints)} /><span>{label}</span></label>)}</div></fieldset><FormFeedback error={formError} /><DialogActions close={() => setSupportDialogOpen(false)} submit="添加支座" /></form></Dialog>}
    {loadDialogOpen && <Dialog title="创建节点集中荷载" copy="输入全局坐标系下的节点力（kN）和节点力矩（kN·m）；零值分量仍会保留在输入记录中。" onClose={() => setLoadDialogOpen(false)}><form onSubmit={submitLoad}><SelectField label="加载节点" value={loadDraft.nodeId} onChange={(value) => setLoadDraft({ ...loadDraft, nodeId: value })} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><div className="load-columns"><fieldset className="resource-fieldset"><legend>节点力（kN）</legend><NumberField label="FX" value={loadDraft.fx} unit="kN" onChange={(value) => setLoadDraft({ ...loadDraft, fx: value })} /><NumberField label="FY" value={loadDraft.fy} unit="kN" onChange={(value) => setLoadDraft({ ...loadDraft, fy: value })} /><NumberField label="FZ" value={loadDraft.fz} unit="kN" onChange={(value) => setLoadDraft({ ...loadDraft, fz: value })} /></fieldset><fieldset className="resource-fieldset"><legend>节点力矩（kN·m）</legend><NumberField label="MX" value={loadDraft.mx} unit="kN·m" onChange={(value) => setLoadDraft({ ...loadDraft, mx: value })} /><NumberField label="MY" value={loadDraft.my} unit="kN·m" onChange={(value) => setLoadDraft({ ...loadDraft, my: value })} /><NumberField label="MZ" value={loadDraft.mz} unit="kN·m" onChange={(value) => setLoadDraft({ ...loadDraft, mz: value })} /></fieldset></div><FormFeedback error={formError} /><DialogActions close={() => setLoadDialogOpen(false)} submit="添加节点荷载" /></form></Dialog>}
  </main>;
}

function AnalysisResultPanel({ result, project }: { result: AnalysisResult; project: FrameProject }) {
  const stale = result.projectRevision !== project.revision - 1;
  const formatEndForces = (values: number[]) => `Fx ${values[0].toFixed(3)} kN · Fy ${values[1].toFixed(3)} kN · Fz ${values[2].toFixed(3)} kN · Mx ${values[3].toFixed(3)} kN·m · My ${values[4].toFixed(3)} kN·m · Mz ${values[5].toFixed(3)} kN·m`;
  const preciseVector = (vector: { x: number; y: number; z: number }) => `(${[vector.x, vector.y, vector.z].map((value) => value.toPrecision(10)).join(", ")})`;
  return <div className="analysis-result-panel">
    <div className="selection-title"><span className="selection-icon"><Calculator size={15} /></span><div><small>最近一次分析</small><strong>3D 线弹性静力</strong></div></div>
    <section className="property-section"><h3>计算输入</h3><dl>
      <div><dt>模型版本</dt><dd>R{result.projectRevision}{stale ? " · 已过期" : " · 当前"}</dd></div>
      <div><dt>理论</dt><dd>Euler-Bernoulli 空间刚架</dd></div>
      <div><dt>求解版本</dt><dd>{result.input.solver?.implementation ?? "T03（未记录）"}</dd></div>
      <div><dt>支座 / 荷载</dt><dd>{result.input.supports.length} / {result.input.nodalLoads.length}</dd></div>
    </dl></section>
    <section className="property-section"><h3>节点结果</h3><div className="analysis-table">{result.nodes.map((node) => <div className="analysis-row" key={node.nodeId}>
      <strong>{result.input.nodes.find((item) => item.id === node.nodeId)?.label ?? node.nodeId}</strong>
      <span title={`${preciseVector(node.displacement)} m`}>位移 {vectorText(node.displacement)} m</span>
      <span title={`${preciseVector(node.rotation)} rad`}>转角 {vectorText(node.rotation)} rad</span>
      <span title={`${preciseVector(node.reaction)} kN`}>反力 {vectorText(node.reaction)} kN</span>
      <span title={`${preciseVector(node.reactionMoment)} kN·m`}>反力矩 {vectorText(node.reactionMoment)} kN·m</span>
    </div>)}</div></section>
    <section className="property-section"><h3>杆端内力（局部轴）</h3><div className="analysis-table">{result.members.map((member) => <div className="analysis-row" key={member.memberId}>
      <strong>{result.input.members.find((item) => item.id === member.memberId)?.label ?? member.memberId} · L {member.length.toFixed(3)} m</strong>
      <span>起点 {formatEndForces(member.localEndForces.start)}</span><span>终点 {formatEndForces(member.localEndForces.end)}</span>
    </div>)}</div></section>
  </div>;
}
function TreeGroup({ label, count, icon, children }: { label: string; count: number; icon: React.ReactNode; children: React.ReactNode }) { return <div className="tree-group"><div className="tree-group-label"><ChevronDown size={13} />{icon}<span>{label}</span><em>{count}</em></div><div className="tree-items">{children}</div></div>; }
function MenuAction({ icon, label, shortcut, onSelect }: { icon: React.ReactNode; label: string; shortcut: string; onSelect(): void }) { return <button className="menu-item" role="menuitem" onClick={onSelect}><span>{icon}{label}</span><kbd>{shortcut}</kbd></button>; }
function Inspector({ title, label, icon, children }: { title: string; label: string; icon: React.ReactNode; children: React.ReactNode }) { return <div className="inspector-content"><div className="selection-title"><span className="selection-icon">{icon}</span><div><small>{title}</small><strong>{label}</strong></div></div>{children}<p className="inspector-note">属性来自当前已应用模型，三维视图与项目文件共享同一对象身份。</p></div>; }
function Identity({ id, label }: { id: string; label: string }) { return <section className="property-section"><h3>标识</h3><dl><div><dt>稳定 ID</dt><dd>{id}</dd></div><div><dt>显示编号</dt><dd>{label}</dd></div></dl></section>; }
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange(value: string): void; options: Array<{ value: string; label: string }> }) { return <label className="field"><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function FormFeedback({ error }: { error: string | null }) { return error ? <p className="form-error" role="alert">{error}</p> : null; }
function MaterialFields({ draft, setDraft }: { draft: MaterialDraft; setDraft(value: MaterialDraft): void }) { return <fieldset className="resource-fieldset"><legend>材料参数</legend><label className="field"><span>材料名称</span><input aria-label="材料名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><NumberField label="弹性模量 E" value={draft.elasticModulusGPa} unit="GPa" onChange={(value) => setDraft({ ...draft, elasticModulusGPa: value })} /><NumberField label="泊松比 ν" value={draft.poissonRatio} unit="无" onChange={(value) => setDraft({ ...draft, poissonRatio: value })} /><NumberField label="密度 ρ" value={draft.densityKgM3} unit="kg/m³" onChange={(value) => setDraft({ ...draft, densityKgM3: value })} /></fieldset>; }
function SectionFields({ draft, setDraft }: { draft: SectionDraft; setDraft(value: SectionDraft): void }) { return <fieldset className="resource-fieldset"><legend>截面参数</legend><label className="field"><span>截面名称</span><input aria-label="截面名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><NumberField label="面积 A" value={draft.areaM2} unit="m²" onChange={(value) => setDraft({ ...draft, areaM2: value })} /><NumberField label="惯性矩 Iy" value={draft.secondMomentYM4} unit="m⁴" onChange={(value) => setDraft({ ...draft, secondMomentYM4: value })} /><NumberField label="惯性矩 Iz" value={draft.secondMomentZM4} unit="m⁴" onChange={(value) => setDraft({ ...draft, secondMomentZM4: value })} /><NumberField label="扭转常数 J" value={draft.torsionalConstantM4} unit="m⁴" onChange={(value) => setDraft({ ...draft, torsionalConstantM4: value })} /></fieldset>; }
function NumberField({ label, value, unit, onChange }: { label: string; value: string; unit: string; onChange(value: string): void }) { return <label className="field"><span>{label}</span><div><input type="number" step="any" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /><em>{unit}</em></div></label>; }
function Dialog({ title, copy, onClose, children }: { title: string; copy: string; onClose(): void; children: React.ReactNode }) { return <div className="dialog-backdrop" onMouseDown={onClose}><section className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={15} /></button></header><p className="dialog-copy">{copy}</p><div className="dialog-form">{children}</div></section></div>; }
function DialogActions({ close, submit }: { close(): void; submit: string }) { return <div className="dialog-actions"><button type="button" className="button ghost" onClick={close}>取消</button><button type="submit" className="button primary">{submit}</button></div>; }
