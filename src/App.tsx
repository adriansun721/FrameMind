import { ModalResultPanel } from "./components/ModalResultPanel";
import { modalDisplayResult } from "./domain/modal";
import { AdditionalMassEditor } from "./components/AdditionalMassEditor";
import { indeterminateRotationComponents } from "./domain/member-releases";
import { MemberReleaseFields } from "./components/MemberReleaseFields";
import { ParametricSectionEditor } from "./components/ParametricSectionEditor";
import { SectionBasisView } from "./components/SectionBasisView";
import { SectionGeometryPreview } from "./components/SectionGeometryPreview";
import type { SectionInput } from "./domain/project";
import { UnitPresetContext, UnitInput, useUnits } from "./components/UnitPresentation";
import { unitPresentation, UNIT_PRESETS, requireUnitPreset } from "./domain/units";
import { PagedItems } from "./components/ProcessDisclosure";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Anchor, ArrowDownToLine, Box, Calculator, ChevronDown, CircleDot, Crosshair, Files, FilePlus2, FolderOpen, Hexagon, Layers3, Library, Link2, Moon, MousePointer2, PanelLeft, PanelRight, Plus, Redo2, Save, Search, Settings, Settings2, Sun, Table2, Trash2, Undo2, Weight, X } from "lucide-react";
import { SceneViewport, type ForceComponent, type ResultViewMode } from "./components/SceneViewport";
import { BottomProperties } from "./components/BottomProperties";
import { ResizableWorkspace } from "./components/ResizableWorkspace";
import type { NodeDraft, MemberDraft } from "./components/model-editing";
import { MemberSectionQuery } from "./components/MemberSectionQuery";
import { AnalysisCaseManager } from "./components/AnalysisCaseManager";
import { LoadCaseManager } from "./components/LoadCaseManager";
import { LoadMenu } from "./components/LoadMenu";
import { LoadCombinationManager } from "./components/LoadCombinationManager";
import { ResourceLibraryPanel, type LibraryResource } from "./components/ResourceLibraryPanel";
import { MemberAnalysisProcess } from "./components/MemberAnalysisProcess";
import { AnalysisProcess } from "./components/AnalysisProcess";
import { EngineeringReportDialog } from "./components/EngineeringReportDialog";
import { StartupRecovery, recoveryTime } from "./components/StartupRecovery";
import { DeepSeekSettingsPanel } from "./components/DeepSeekSettingsPanel";
import { AiConversationPanel } from "./components/AiConversationPanel";
import { ResultReferenceDetails } from "./components/AiResultReferences";
import type { ResultReference } from "./workspace/ai-results";
import type { AiObjectRef } from "./workspace/ai-tools";
import { captureAiSnapshot, type AiToolResult } from "./workspace/ai-tools";
import { SectionStageConfirmation } from "./workspace/section-stage";
import type { AnalysisPairIds } from "./workspace/ai-comparison";
import { ConditionsStageConfirmation } from "./workspace/analysis-conditions";
import type { FramePreview } from "./workspace/frame-proposal";
import { FrameStageConfirmation } from "./workspace/frame-confirmation";
import { TaskDraftStageConfirmation } from "./workspace/task-confirmation";
import { ModelEditConfirmation } from "./workspace/model-edits";
import { TopologyEditor } from "./components/TopologyEditor";
import { NodeMergeEditor } from "./components/NodeMergeEditor";
import { calculateMemberGeometry } from "./domain/member-geometry";
import {
  addMaterial, addCatalogMaterial, addNodalLoad, addSection, addCatalogSection, addSupport, attachAnalysisResult, createProject, updateMaterial, updateSupport, updateNodalLoad,
  addUniformLoad, updateUniformLoad, deleteUniformLoad, updateSelfWeight, DEFAULT_LOAD_CASE, selectLoadCase, selectLoadCombination, selectAnalysisSource, selectAnalysisCase, getAnalysisSourceId,
  type DofRestraints, type FrameProject, type MaterialId, type MemberId, type NodeId, type SectionId,
} from "./domain/project";
import { getMaterialCatalogEntry, getSectionCatalogEntry, MATERIAL_CATALOG, SECTION_CATALOG } from "./domain/resource-library";
import type { CatalogSource, ResourceProvenance } from "./domain/project";
import { ProjectHistory } from "./domain/project-history";
import { applyProjectEdits } from "./domain/project-operations";
import { prepareDrawnMemberEdits } from "./domain/work-plane";
import { captureAnalysisInput, getMemberResponseSamples, getMemberSectionForces, getSelfWeightSummary, getActiveAnalysisResult, getAnalysisResultForSource, isAnalysisResultCurrent, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult } from "./domain/analysis";
import { ANALYSIS_FORCE_COMPONENTS, compareAnalysisResults, type AnalysisComparison, type AnalysisForceVector } from "./domain/analysis-comparison";
import { ANALYSIS_FIELD_LABELS, ANALYSIS_STAGE_LABELS, AnalysisFailure, type AnalysisTarget } from "./domain/analysis-diagnostics";
import { decodeProject, encodeProject } from "./domain/project-file";
import { captureProjectCheckpoint, isProjectCheckpointCurrent } from "./workspace/async-guards";
import { AnalysisCancelledError, startAnalysisTask, type AnalysisTask, type AnalysisTaskPhase } from "./workspace/analysis-task";
import { AnalysisServiceFailure } from "./domain/analysis-service";
import { TaskScheduler, type ScheduledTaskHandle, type TaskSchedulerSnapshot } from "./workspace/task-scheduler";
import { RecoveryAutosave } from "./workspace/recovery-autosave";
import type { AppTheme, RecoveryEntry, RecoverySaveRequest } from "../electron/contracts";

type StatusTone = "neutral" | "success" | "error";
type Selection = AnalysisTarget | null;
interface StatusMessage { tone: StatusTone; text: string; }
interface MaterialDraft { name: string; elasticModulusGPa: string; poissonRatio: string; densityKgM3: string; }
interface SectionDraft { name: string; areaM2: string; secondMomentYM4: string; secondMomentZM4: string; torsionalConstantM4: string; }
interface LoadDraft { nodeId: string; loadCaseId: string; fx: string; fy: string; fz: string; mx: string; my: string; mz: string; }
interface UniformDraft { memberId: string; loadCaseId: string; coordinateSystem: "global" | "local"; qx: string; qy: string; qz: string; }
interface SelfWeightDraft { enabled: boolean; loadCaseId: string; gx: string; gy: string; gz: string; }
const defaultUniform: UniformDraft = { memberId: "", loadCaseId: DEFAULT_LOAD_CASE, coordinateSystem: "global", qx: "0", qy: "0", qz: "0" };
const defaultSelfWeight: SelfWeightDraft = { enabled: false, loadCaseId: DEFAULT_LOAD_CASE, gx: "0", gy: "0", gz: "-9.81" };

const defaultMaterial: MaterialDraft = { name: "Q355", elasticModulusGPa: "206", poissonRatio: "0.3", densityKgM3: "7850" };
const defaultSection: SectionDraft = { name: "箱形截面", areaM2: "0.01", secondMomentYM4: "0.0001", secondMomentZM4: "0.0001", torsionalConstantM4: "0.00015" };
const defaultLoad: LoadDraft = { nodeId: "", loadCaseId: DEFAULT_LOAD_CASE, fx: "0", fy: "0", fz: "0", mx: "0", my: "0", mz: "0" };
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
const ANALYSIS_PHASE_TEXT: Record<AnalysisTaskPhase, string> = {
  "model-check": "正在检查模型",
  assembly: "正在组装刚度矩阵",
  solve: "正在求解方程",
  recovery: "正在恢复分析结果",
};

export function App() {
  const [theme, setTheme] = useState<AppTheme>(() => {
    try { return localStorage.getItem("framemind.theme") === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    try { localStorage.setItem("framemind.theme", theme); }
    catch { setStatus({ tone: "error", text: "主题已切换，但无法保存偏好" }); }
    void window.frameMind?.setTheme(theme).catch(() => setStatus({ tone: "error", text: "无法更新窗口主题" }));
  }, [theme]);
  const [project, setProject] = useState<FrameProject>(() => createProject());
  const u = unitPresentation(project.displayUnitPreset);
  const [aiPreview, setAiPreview] = useState<FramePreview | null>(null);
  const activeProjectRef = useRef(project); const activeSessionRef = useRef(0); activeProjectRef.current = project;
  const [projectPath, setProjectPath] = useState<string | null>(null); const [savedRevision, setSavedRevision] = useState(0); const [savedProject, setSavedProject] = useState<FrameProject | null>(null);
  const [startupReady, setStartupReady] = useState(false);
  const [recoverySource, setRecoverySource] = useState<RecoveryEntry | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [formalSave, setFormalSave] = useState<RecoverySaveRequest["formalSave"]>(null);
  const formalSaveRef = useRef(formalSave); formalSaveRef.current = formalSave;
  const [recoveryAutosave] = useState(() => new RecoveryAutosave((request) => window.frameMind.saveRecovery(request),
    (failed) => setRecoveryError(failed ? "自动恢复快照写入失败；最近完整快照保留。请手动保存项目，应用将继续重试。" : null)));
  const recoveryTimerRef = useRef<number | null>(null);
  const captureRecoveryRef = useRef<() => void>(() => {});
  const [selection, setSelection] = useState<Selection>(null);
  const projectHistoryRef = useRef(new ProjectHistory());
  const frameConfirmationRef = useRef(new FrameStageConfirmation());
  const taskDraftConfirmationRef = useRef(new TaskDraftStageConfirmation());
  const editConfirmationRef = useRef(new ModelEditConfirmation());
  const sectionConfirmationRef = useRef(new SectionStageConfirmation());
  const conditionsConfirmationRef = useRef(new ConditionsStageConfirmation());
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => new Set());
  const [batchDialog, setBatchDialog] = useState<"node" | "member" | null>(null);
  const [batchDraft, setBatchDraft] = useState({ x: "0", y: "0", z: "0", rotationDegrees: "0" });
  const [resultView, setResultView] = useState<ResultViewMode>("model");
  const [forceComponent, setForceComponent] = useState<ForceComponent>("N");
  const [deformationScale, setDeformationScale] = useState(100);
  const [resultFocus, setResultFocus] = useState<{ memberId: string; position: number } | null>(null);
  const [comparisonPair, setComparisonPair] = useState<AnalysisPairIds>();
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [resultReference, setResultReference] = useState<ResultReference | null>(null);
  const [resourcePanelOpen, setResourcePanelOpen] = useState(true);
  const [propertyPanelOpen, setPropertyPanelOpen] = useState(true);
  const [sidebarModule, setSidebarModule] = useState<"project" | "search" | "library">("project");
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(true);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [nodeDialogOpen, setNodeDialogOpen] = useState(false); const [resourceDialogOpen, setResourceDialogOpen] = useState(false); const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false); const [loadDialogOpen, setLoadDialogOpen] = useState(false); const [analysisBusy, setAnalysisBusy] = useState(false); const [analysisPhase, setAnalysisPhase] = useState<AnalysisTaskPhase | null>(null);
  const [analysisFailure, setAnalysisFailure] = useState<{ failure: AnalysisFailure; revision: number } | null>(null);
  const [diagnosticFitRequest, setDiagnosticFitRequest] = useState(0);
  const [nodeDraft, setNodeDraft] = useState<NodeDraft>({ x: "0", y: "0", z: "0" });
  const [newNodeDraft, setNewNodeDraft] = useState<NodeDraft>({ x: "0", y: "0", z: "0" });
  const [materialDraft, setMaterialDraft] = useState<MaterialDraft>(defaultMaterial); const [sectionDraft, setSectionDraft] = useState<SectionDraft>(defaultSection);
  const [materialCatalogId, setMaterialCatalogId] = useState(""); const [sectionCatalogId, setSectionCatalogId] = useState("");
  const [memberDraft, setMemberDraft] = useState<MemberDraft>({ startNodeId: "", endNodeId: "", materialId: "", sectionId: "", rotationDegrees: "0" });
  const [newMemberDraft, setNewMemberDraft] = useState<MemberDraft>({ startNodeId: "", endNodeId: "", materialId: "", sectionId: "", rotationDegrees: "0" });
  const [supportNodeId, setSupportNodeId] = useState(""); const [supportRestraints, setSupportRestraints] = useState<DofRestraints>([true, true, true, true, true, true]);
  const [loadDraft, setLoadDraft] = useState<LoadDraft>(defaultLoad);
  const [uniformDraft, setUniformDraft] = useState<UniformDraft>(defaultUniform);
  const [uniformDialogOpen, setUniformDialogOpen] = useState(false);
  const [selfWeightDraft, setSelfWeightDraft] = useState<SelfWeightDraft>(defaultSelfWeight);
  const [selfWeightDialogOpen, setSelfWeightDialogOpen] = useState(false);
  const [analysisCaseManagerOpen, setAnalysisCaseManagerOpen] = useState(false);
  const [historyAnalysisId, setHistoryAnalysisId] = useState<string>();
  const [loadCaseManagerOpen, setLoadCaseManagerOpen] = useState(false);
  const [loadCombinationManagerOpen, setLoadCombinationManagerOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [drawingReset, setDrawingReset] = useState(0);
  useEffect(() => { if (resultView !== "model") setDrawingEnabled(false); }, [resultView]);
  const [status, setStatus] = useState<StatusMessage>({ tone: "neutral", text: "就绪" });
  const analysisRunRef = useRef(0);
  const analysisTaskRef = useRef<{ id: number; checkpoint: ReturnType<typeof captureProjectCheckpoint>; task: AnalysisTask } | null>(null);
  const pendingAnalysisInputsRef = useRef(new Map<string, AnalysisInputSnapshot>());
  const analysisSchedulerRef = useRef(new TaskScheduler<unknown, unknown>({ maxConcurrent: 1 }));
  const analysisHandlesRef = useRef(new Map<string, ScheduledTaskHandle<unknown>>());
  const analysisExecutionRef = useRef(new Map<string, { runId: number; checkpoint: ReturnType<typeof captureProjectCheckpoint>; source: FrameProject }>());
  const [taskQueue, setTaskQueue] = useState<TaskSchedulerSnapshot>(() => analysisSchedulerRef.current.snapshot());
  const dirty = useMemo(() => savedProject === null ? project.revision !== savedRevision || project.displayUnitPreset !== undefined : !sameInputValue(project, savedProject), [project, savedProject, savedRevision]);
  const memberCreationAvailable = project.nodes.length >= 2 && project.materials.length > 0 && project.sections.length > 0;
  const activeCase = project.loadCases.find((item) => item.id === project.activeLoadCaseId)!;
  const activeCombination = project.loadCombinations.find((item) => item.id === project.activeLoadCombinationId);
  const activeAnalysisCase = project.analysisCases.find((c) => c.id === project.activeAnalysisCaseId);
  const activeSource = activeAnalysisCase ?? activeCombination ?? activeCase;
  const combinationInput = useMemo(() => {
    if (!project.activeLoadCombinationId) return null;
    try { return captureAnalysisInput(project); } catch { return null; }
  }, [project]);
  const caseLoads = useMemo(() => project.nodalLoads.filter((load) => load.loadCaseId === activeCase.id), [project.nodalLoads, activeCase.id]);
  const caseUniformLoads = useMemo(() => project.uniformLoads.filter((load) => load.loadCaseId === activeCase.id), [project.uniformLoads, activeCase.id]);
  const caseSelfWeightEnabled = project.selfWeight.enabled && project.selfWeight.loadCaseId === activeCase.id;
  const referenceAnalysis = resultReference ? project.analysisResults.find((result) => result.id === resultReference.analysisId) : undefined;
  const caseResult = project.analysisResults.find((r) => r.id === historyAnalysisId) ?? referenceAnalysis ?? getActiveAnalysisResult(project);
  const [modeNumber, setModeNumber] = useState(1);
  const displayedResult = useMemo(() => caseResult?.modal ? modalDisplayResult(caseResult, modeNumber) : caseResult, [caseResult, modeNumber]);
  const resultCurrency = useMemo(() => new Map(project.analysisResults.map((result) => [result.id, isAnalysisResultCurrent(project, result)])), [project]);
  const resultIsCurrent = (result: AnalysisResult) => resultCurrency.get(result.id) ?? false;
  const resultSources = [
    ...project.analysisCases.map((source) => ({ id: source.id })),
    ...project.loadCases.map((source) => ({ id: source.id, combination: false })),
    ...project.loadCombinations.map((source) => ({ id: source.id, combination: true })),
  ];

  useEffect(() => {
    const scheduler = analysisSchedulerRef.current;
    const refresh = () => setTaskQueue(scheduler.snapshot(project.id));
    refresh();
    return scheduler.subscribe((event) => {
      if (event.ownership.projectId !== project.id) return;
      refresh();
      if (event.type === "created" && event.task.kind === "analysis" && event.task.status === "queued") setStatus({ tone: "neutral", text: "分析任务已排队，启动时将读取最新模型" });
    });
  }, [project.id]);

  const selectedNode = selection?.kind === "node" ? project.nodes.find((item) => item.id === selection.id) ?? null : null;
  const selectedMember = selection?.kind === "member" ? project.members.find((item) => item.id === selection.id) ?? null : null;
  const selectedMaterial = selection?.kind === "material" ? project.materials.find((item) => item.id === selection.id) ?? null : null;
  const selectedSection = selection?.kind === "section" ? project.sections.find((item) => item.id === selection.id) ?? null : null;
  const selectedSupport = selection?.kind === "support" ? project.supports.find((item) => item.id === selection.id) ?? null : null;
  const selectedLoad = selection?.kind === "load" ? project.nodalLoads.find((item) => item.id === selection.id) ?? null : null;
  const selectedUniform = selection?.kind === "uniform-load" ? project.uniformLoads.find((item) => item.id === selection.id) ?? null : null;
  const currentSelectionLabel = selectedNode?.label ?? selectedMember?.label ?? selectedMaterial?.label ?? selectedSection?.label ?? selectedSupport?.label ?? selectedLoad?.label ?? selectedUniform?.label ?? "无选择";
  const aiSelection: AiObjectRef[] = selectedNodeIds.size + selectedMemberIds.size > 0
    ? [...project.nodes.filter((node) => selectedNodeIds.has(node.id)).map((node) => ({ kind: "node" as const, id: node.id })),
      ...project.members.filter((member) => selectedMemberIds.has(member.id)).map((member) => ({ kind: "member" as const, id: member.id }))]
    : selection?.kind === "node" || selection?.kind === "member" ? [selection] : [];
  const memberGeometry = useMemo(() => {
    if (!selectedMember) return null;
    const start = project.nodes.find((item) => item.id === selectedMember.startNodeId); const end = project.nodes.find((item) => item.id === selectedMember.endNodeId);
    return start && end ? calculateMemberGeometry(start.position, end.position, selectedMember.rotationDegrees) : null;
  }, [project.nodes, selectedMember]);

  const activateProject = (next: FrameProject, newSession: boolean, historyMode: "record" | "restore" | "reset" = newSession ? "reset" : "record") => {
    const previous = activeProjectRef.current;
    if (!newSession && next.displayUnitPreset !== previous.displayUnitPreset) next = { ...next, displayUnitPreset: previous.displayUnitPreset };
    if (newSession && startupReady) captureRecoveryRef.current();
    if (newSession) { setDrawingEnabled(false); setDrawingReset((value) => value + 1); }
    if (historyMode === "reset") {
      projectHistoryRef.current.reset();
      frameConfirmationRef.current = new FrameStageConfirmation();
      taskDraftConfirmationRef.current = new TaskDraftStageConfirmation();
      editConfirmationRef.current = new ModelEditConfirmation();
      setComparisonPair(undefined);
      sectionConfirmationRef.current = new SectionStageConfirmation();
      conditionsConfirmationRef.current = new ConditionsStageConfirmation();
    }
    if (historyMode === "record") projectHistoryRef.current.record(previous, next);
    setHistoryVersion((value) => value + 1);
    if (newSession || previous.activeLoadCaseId !== next.activeLoadCaseId || previous.activeLoadCombinationId !== next.activeLoadCombinationId || previous.activeAnalysisCaseId !== next.activeAnalysisCaseId) {
      setHistoryAnalysisId(undefined);
      setResultReference(null); setResultFocus(null);
      if (newSession) activeSessionRef.current += 1;
      if (newSession) analysisSchedulerRef.current.cancelProject(previous.id);
      setAnalysisFailure(null);
      const activeAnalysis = newSession ? analysisTaskRef.current : null;
      if (activeAnalysis) {
        analysisRunRef.current += 1;
        analysisTaskRef.current = null;
        activeAnalysis.task.cancel();
        setAnalysisBusy(false);
        setAnalysisPhase(null);
      }
    }
    activeProjectRef.current = next; setProject(next);
  };
  const restoreHistory = (direction: "undo" | "redo") => {
    setDrawingReset((value) => value + 1);
    const current = activeProjectRef.current;
    const restored = direction === "undo" ? projectHistoryRef.current.undo(current) : projectHistoryRef.current.redo(current);
    if (!restored) return;
    activateProject(restored, false, "restore");
    setSelection(null); setSelectedNodeIds(new Set()); setSelectedMemberIds(new Set()); setFormError(null);
    setStatus({ tone: "neutral", text: direction === "undo" ? "已撤销上一组变更" : "已重做上一组变更" });
  };
  const selectObject = (next: Selection, sourceProject = project) => {
    setSelection(next); setFormError(null); if (!next) return;
    if (next.kind === "node") { const item = sourceProject.nodes.find((node) => node.id === next.id); if (item) setNodeDraft({ x: String(item.position.x), y: String(item.position.y), z: String(item.position.z) }); }
    if (next.kind === "member") { const item = sourceProject.members.find((member) => member.id === next.id); if (item) setMemberDraft({ startNodeId: item.startNodeId, endNodeId: item.endNodeId, materialId: item.materialId, sectionId: item.sectionId, rotationDegrees: String(item.rotationDegrees), endReleases: item.endReleases }); }
    if (next.kind === "material") { const item = sourceProject.materials.find((material) => material.id === next.id); if (item) setMaterialDraft({ name: item.name, elasticModulusGPa: String(item.elasticModulusGPa), poissonRatio: String(item.poissonRatio), densityKgM3: String(item.densityKgM3) }); }
    if (next.kind === "section") { const item = sourceProject.sections.find((section) => section.id === next.id); if (item) setSectionDraft({ name: item.name, areaM2: String(item.areaM2), secondMomentYM4: String(item.secondMomentYM4), secondMomentZM4: String(item.secondMomentZM4), torsionalConstantM4: String(item.torsionalConstantM4) }); }
    if (next.kind === "support") { const item = sourceProject.supports.find((support) => support.id === next.id); if (item) { setSupportNodeId(item.nodeId); setSupportRestraints([...item.restraints]); } }
    if (next.kind === "load") { const item = sourceProject.nodalLoads.find((load) => load.id === next.id); if (item) setLoadDraft({ nodeId: item.nodeId, loadCaseId: item.loadCaseId, fx: String(item.force.x), fy: String(item.force.y), fz: String(item.force.z), mx: String(item.moment.x), my: String(item.moment.y), mz: String(item.moment.z) }); }
    if (next.kind === "uniform-load") { const item = sourceProject.uniformLoads.find((load) => load.id === next.id); if (item) setUniformDraft({ memberId: item.memberId, loadCaseId: item.loadCaseId, coordinateSystem: item.coordinateSystem, qx: String(item.intensity.x), qy: String(item.intensity.y), qz: String(item.intensity.z) }); }
  };

  const [topologyOpen, setTopologyOpen] = useState(false);
  const [nodeMergeOpen, setNodeMergeOpen] = useState(false);
  const [sectionEditor, setSectionEditor] = useState<{ id?: string; input?: SectionInput } | null>(null);
  const submitUniform = (event: React.FormEvent, editing: boolean) => {
    event.preventDefault();
    try {
      const properties = { kind: "uniform" as const, memberId: uniformDraft.memberId as MemberId, coordinateSystem: uniformDraft.coordinateSystem, loadCaseId: uniformDraft.loadCaseId, intensity: { x: parseNumber(uniformDraft.qx, "qx"), y: parseNumber(uniformDraft.qy, "qy"), z: parseNumber(uniformDraft.qz, "qz") } };
      const updated = editing && selectedUniform ? updateUniformLoad(project, selectedUniform.id, properties) : addUniformLoad(project, properties);
      activateProject(selectLoadCase(updated, properties.loadCaseId), false);
      if (!editing) setSelection({ kind: "uniform-load", id: updated.uniformLoads.at(-1)!.id });
      setUniformDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: editing ? "已更新均布荷载" : "已创建均布荷载" });
    } catch (error) { setFormError(error instanceof Error ? error.message : "均布荷载提交失败"); }
  };
  const removeUniform = () => {
    if (!selectedUniform) return;
    activateProject(deleteUniformLoad(project, selectedUniform.id), false); setSelection(null); setFormError(null); setStatus({ tone: "success", text: "已删除均布荷载" });
  };

  const beginNewProject = () => { if (dirty && !window.confirm("当前项目有未保存修改，确定新建项目吗？")) return; const next = createProject(); activateProject(next, true); setProjectPath(null); setFormalSave(null); setRecoverySource(null); setSavedRevision(0); setSavedProject(next); setSelection(null); setStatus({ tone: "neutral", text: "已创建空白项目" }); };
  const switchSidebarModule = (module: typeof sidebarModule) => {
    setResourcePanelOpen((open) => module === sidebarModule ? !open : true);
    setSidebarModule(module);
  };
  const importLibraryResource = (resource: LibraryResource) => {
    try {
      const provenance: ResourceProvenance = resource.catalogId && resource.source
        ? { kind: "catalog", catalogId: resource.catalogId, source: resource.source } : { kind: "custom" };
      const updated = resource.kind === "material" ? addMaterial(project, resource.properties, provenance) : addSection(project, resource.properties, provenance);
      activateProject(updated, false);
      setStatus({ tone: "success", text: `已加入${resource.kind === "material" ? "材料" : "截面"} ${resource.properties.name}` });
    } catch (error) { setStatus({ tone: "error", text: error instanceof Error ? error.message : "加入项目失败" }); }
  };
  const openProject = async () => {
    if (dirty && !window.confirm("当前项目有未保存修改，确定打开其他项目吗？")) return;
    const checkpoint = captureProjectCheckpoint(project, activeSessionRef.current);
    try {
      const result = await window.frameMind.openProject(); if (result.status === "cancelled" || !isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "exact")) return;
      const opened = decodeProject(result.content); activateProject(opened, true); setProjectPath(result.path); setSavedRevision(opened.revision); setSavedProject(opened); setSelection(null); setStatus({ tone: "success", text: `已打开 ${filename(result.path)}` });
      setFormalSave({ path: result.path, savedAt: result.savedAt ?? opened.updatedAt }); setRecoverySource(null);
    } catch (error) { if (isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "exact")) setStatus({ tone: "error", text: error instanceof Error ? error.message : "打开项目失败" }); }
  };
  const saveProject = async () => {
    const source = activeProjectRef.current;
    const checkpoint = captureProjectCheckpoint(source, activeSessionRef.current);
    const content = encodeProject(source);
    try {
      const result = await window.frameMind.saveProject({ path: projectPath, content }); if (result.status === "cancelled" || !isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "identity")) return;
      setProjectPath(result.path); setSavedRevision(checkpoint.revision); setSavedProject(source); setStatus({ tone: "success", text: isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "exact") ? `已保存 ${filename(result.path)}` : `已保存 R${checkpoint.revision}，当前模型仍有未保存修改` });
      setFormalSave({ path: result.path, savedAt: result.savedAt ?? new Date().toISOString() }); setRecoverySource(null);
    } catch (error) { if (isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "identity")) setStatus({ tone: "error", text: error instanceof Error ? error.message : "保存项目失败，原文件未更改" }); }
  };

  const submitNode = (event: React.FormEvent) => {
    event.preventDefault(); const position = { x: Number(newNodeDraft.x), y: Number(newNodeDraft.y), z: Number(newNodeDraft.z) };
    if (Object.values(newNodeDraft).some((value) => value.trim() === "") || !Object.values(position).every(Number.isFinite)) { setFormError("请输入有效的有限数值"); return; }
    try { const updated = applyProjectEdits(project, [{ type: "create_node", position }]).project; activateProject(updated, false); const node = updated.nodes.at(-1)!; setSelection({ kind: "node", id: node.id }); setNodeDraft(newNodeDraft); setNodeDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: `已创建 ${node.label}` }); }
    catch (error) { setFormError(error instanceof Error ? error.message : "创建节点失败"); }
  };
  const submitResources = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const materialEntry = materialCatalogId ? getMaterialCatalogEntry(materialCatalogId) : undefined;
      const sectionEntry = sectionCatalogId ? getSectionCatalogEntry(sectionCatalogId) : undefined;
      let updated = materialEntry
        ? addCatalogMaterial(project, materialToNumbers(materialDraft), { kind: "catalog", catalogId: materialEntry.catalogId, source: materialEntry.source })
        : addMaterial(project, materialToNumbers(materialDraft));
      updated = sectionEntry
        ? addCatalogSection(updated, sectionEntry, { kind: "catalog", catalogId: sectionEntry.catalogId, source: sectionEntry.source })
        : addSection(updated, sectionToNumbers(sectionDraft));
      activateProject(updated, false); setResourceDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: `已创建材料 ${updated.materials.at(-1)!.label} 与截面 ${updated.sections.at(-1)!.label}` });
    }
    catch (error) { setFormError(error instanceof Error ? error.message : "创建材料与截面失败"); }
  };
  const openMemberDialog = () => {
    setNewMemberDraft({ startNodeId: project.nodes[0]?.id ?? "", endNodeId: project.nodes[1]?.id ?? project.nodes[0]?.id ?? "", materialId: project.materials[0]?.id ?? "", sectionId: project.sections[0]?.id ?? "", rotationDegrees: "0" }); setFormError(null); setMemberDialogOpen(true);
  };
  const openSupportDialog = () => { setSupportNodeId(project.nodes[0]?.id ?? ""); setSupportRestraints([true, true, true, true, true, true]); setFormError(null); setSupportDialogOpen(true); };
  const openLoadDialog = () => { setLoadDraft({ ...defaultLoad, loadCaseId: activeCase.id, nodeId: project.nodes.at(-1)?.id ?? project.nodes[0]?.id ?? "" }); setFormError(null); setLoadDialogOpen(true); };
  const openSelfWeightDialog = (loadCaseId = project.selfWeight.loadCaseId) => { setSelfWeightDraft({ enabled: project.selfWeight.enabled && project.selfWeight.loadCaseId === loadCaseId, loadCaseId, gx: String(project.selfWeight.gravity.x), gy: String(project.selfWeight.gravity.y), gz: String(project.selfWeight.gravity.z) }); setFormError(null); setSelfWeightDialogOpen(true); };
  const openNodeDialog = () => { setNewNodeDraft({ x: "0", y: "0", z: "0" }); setFormError(null); setNodeDialogOpen(true); };
  const submitMember = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const updated = applyProjectEdits(project, [{ type: "create_member", properties: { startNodeId: newMemberDraft.startNodeId as NodeId, endNodeId: newMemberDraft.endNodeId as NodeId, materialId: newMemberDraft.materialId as MaterialId, sectionId: newMemberDraft.sectionId as SectionId, rotationDegrees: parseNumber(newMemberDraft.rotationDegrees, "截面转角"), ...(newMemberDraft.endReleases ? { endReleases: newMemberDraft.endReleases } : {}) } }]).project;
      activateProject(updated, false); const member = updated.members.at(-1)!; setSelection({ kind: "member", id: member.id }); setMemberDraft(newMemberDraft); setMemberDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: `已创建 ${member.label}` });
    } catch (error) { setFormError(error instanceof Error ? error.message : "创建杆件失败"); }
  };
  const submitSupport = (event: React.FormEvent) => {
    event.preventDefault();
    try { const updated = addSupport(project, supportNodeId as NodeId, supportRestraints); activateProject(updated, false); setSelection({ kind: "support", id: updated.supports.at(-1)!.id }); setSupportDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: `已创建节点支座 ${updated.supports.at(-1)!.label}` }); }
    catch (error) { setFormError(error instanceof Error ? error.message : "创建支座失败"); }
  };
  const submitLoad = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const vector = (x: string, y: string, z: string, name: string) => ({ x: parseNumber(x, `${name} X`), y: parseNumber(y, `${name} Y`), z: parseNumber(z, `${name} Z`) });
      const updated = addNodalLoad(project, loadDraft.nodeId as NodeId, vector(loadDraft.fx, loadDraft.fy, loadDraft.fz, "节点力"), vector(loadDraft.mx, loadDraft.my, loadDraft.mz, "节点力矩"), loadDraft.loadCaseId);
      activateProject(selectLoadCase(updated, loadDraft.loadCaseId), false); setSelection({ kind: "load", id: updated.nodalLoads.at(-1)!.id }); setLoadDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: `已创建节点荷载 ${updated.nodalLoads.at(-1)!.label}` });
    } catch (error) { setFormError(error instanceof Error ? error.message : "创建节点荷载失败"); }
  };
  const submitSelfWeight = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const settings = { enabled: selfWeightDraft.enabled, loadCaseId: selfWeightDraft.loadCaseId, gravity: { x: parseNumber(selfWeightDraft.gx, "重力 X"), y: parseNumber(selfWeightDraft.gy, "重力 Y"), z: parseNumber(selfWeightDraft.gz, "重力 Z") } };
      const preserveOtherCase = !settings.enabled && project.selfWeight.enabled && project.selfWeight.loadCaseId !== settings.loadCaseId;
      const updated = preserveOtherCase ? project : updateSelfWeight(project, settings);
      activateProject(selectLoadCase(updated, settings.loadCaseId), false); setSelection(null); setSelfWeightDialogOpen(false); setFormError(null); setStatus({ tone: "success", text: preserveOtherCase ? `${settings.loadCaseId} 未启用结构自重` : settings.enabled ? `已启用结构自重 · ${settings.loadCaseId}` : "已关闭结构自重" });
    } catch (error) { setFormError(error instanceof Error ? error.message : "保存自重设置失败"); }
  };
  const cancelAnalysis = () => {
    const handles = [...analysisHandlesRef.current.values()];
    const activeAnalysis = analysisTaskRef.current;
    if (!activeAnalysis && !handles.length) return;
    analysisRunRef.current += 1;
    analysisTaskRef.current = null;
    for (const handle of handles) handle.cancel();
    activeAnalysis?.task.cancel();
    setAnalysisBusy(false);
    setAnalysisPhase(null);
    if (activeAnalysis && isProjectCheckpointCurrent(activeAnalysis.checkpoint, activeProjectRef.current, activeSessionRef.current, "exact")) {
      setStatus({ tone: "neutral", text: "分析已取消，当前模型和已有结果仍可继续使用" });
    }
  };

  const runAnalysis = async (showResults = false, requestedSourceId?: string, frozenInput?: AnalysisInputSnapshot): Promise<AiToolResult> => {
    const current = activeProjectRef.current;
    requestedSourceId ??= current.activeAnalysisCaseId ?? current.activeLoadCombinationId ?? current.activeLoadCaseId;
    if (requestedSourceId && ![...current.loadCases, ...current.loadCombinations, ...current.analysisCases].some((item) => item.id === requestedSourceId)) return { status: "missing-input", message: `任务分析来源 ${requestedSourceId} 已删除，请明确新的来源`, context: captureAiSnapshot(current, []).context };
    const source = selectAnalysisSource(current, requestedSourceId);
    const context = captureAiSnapshot(source, []).context;
    if (frozenInput && !sameInputValue(captureAnalysisInput(source), frozenInput)) return { status: "failed", message: "当前模型与保存的计算输入不一致，请核对后重新请求计算", context };
    if (source !== current) activateProject(source, false, "restore");
    const projectId = current.id;
    const latestSource = () => {
      const latest = activeProjectRef.current;
      if (latest.id !== projectId) throw new Error("项目已切换，旧分析任务已取消");
      if (!requestedSourceId) return latest;
      if (![...latest.loadCases, ...latest.loadCombinations, ...latest.analysisCases].some((item) => item.id === requestedSourceId)) throw new Error(`任务分析来源 ${requestedSourceId} 已删除，请明确新的来源`);
      return selectAnalysisSource(latest, requestedSourceId);
    };
    setHistoryAnalysisId(undefined);
    setAnalysisBusy(true); setAnalysisPhase(null); setAnalysisFailure(null); setStatus({ tone: "neutral", text: "分析任务已提交，等待计算资源" });
    try {
      const handle = analysisSchedulerRef.current.submit({
        projectId, kind: "analysis", goal: requestedSourceId ? `计算 ${requestedSourceId}` : "计算当前模型", queuedRevision: current.revision, analysisSourceId: requestedSourceId,
        getInput: () => {
          const input = captureAnalysisInput(latestSource());
          if (frozenInput && !sameInputValue(input, frozenInput)) throw new Error("当前模型与保存的计算输入不一致");
          return frozenInput ?? input;
        },
        execute: async (input, taskContext) => {
          pendingAnalysisInputsRef.current.set(taskContext.ownership.taskId, input as AnalysisInputSnapshot);
          const executionSource = latestSource();
          const checkpoint = captureProjectCheckpoint(executionSource, activeSessionRef.current);
          const runId = ++analysisRunRef.current;
          setAnalysisBusy(true); setAnalysisPhase(null); setStatus({ tone: "neutral", text: "分析任务已启动，正在检查模型" });
          const task = startAnalysisTask(input as AnalysisInputSnapshot, {
            onPhase: (phase) => {
              taskContext.reportPhase(phase);
              if (analysisTaskRef.current?.id !== runId || !isProjectCheckpointCurrent(checkpoint, activeProjectRef.current, activeSessionRef.current, "exact")) return;
              setAnalysisPhase(phase); setStatus({ tone: "neutral", text: `${ANALYSIS_PHASE_TEXT[phase]}…` });
            },
          });
          analysisExecutionRef.current.set(taskContext.ownership.taskId, { runId, checkpoint, source: executionSource });
          analysisTaskRef.current = { id: runId, checkpoint, task };
          taskContext.signal.addEventListener("abort", () => task.cancel(), { once: true });
          try {
            const result = await task.promise;
            taskContext.bindAnalysis(result.id);
            return result;
          } finally {
            if (analysisTaskRef.current?.id === runId) analysisTaskRef.current = null;
          }
        },
      });
      analysisHandlesRef.current.set(handle.taskId, handle);
      return await handle.promise.then((result): AiToolResult => {
        const execution = analysisExecutionRef.current.get(handle.ownerTaskId);
        const analysisResult = result as AnalysisResult;
        if (!execution || !isProjectCheckpointCurrent(execution.checkpoint, activeProjectRef.current, activeSessionRef.current, "exact")) return { status: "cancelled", message: "分析上下文已变化，旧结果未应用；已确认模型保留", context };
        const unchecked = analysisResult.discretization?.status === "budget-exhausted" || analysisResult.modal?.convergence.status === "budget-exhausted";
        if (analysisResult.modal) setModeNumber(1);
        const updated = attachAnalysisResult(activeProjectRef.current, analysisResult); activateProject(updated, false, "restore"); setSelection(null); setStatus({ tone: unchecked ? "neutral" : "success", text: unchecked ? "计算完成 · 预算内未满足细分精度，结果未收敛，仅供核查" : analysisResult.modal ? `分析完成 · ${analysisResult.modal.modes.length} 阶模态 · 总质量 ${analysisResult.modal.totalMassKg.toPrecision(6)} kg` : `分析完成 · ${analysisResult.nodes.length} 个节点结果，${analysisResult.members.length} 根杆件结果` });
        setResultReference(null); setResultFocus(null);
        if (showResults) { setResultView("deformation"); setPropertyPanelOpen(true); }
        return { status: "completed", message: unchecked ? "本地计算完成，但预算内未满足细分精度，结果未收敛，仅供核查" : `本地分析完成 · ${analysisResult.nodes.length} 个节点、${analysisResult.members.length} 根杆件，已展示结果`, context,
          data: { analysisId: analysisResult.id, modelRevision: execution.checkpoint.revision, units: execution.source.units,
            analysisSourceId: getAnalysisSourceId(analysisResult.input), analysisCase: analysisResult.input.analysisCase,
            loadCase: analysisResult.input.combination ? undefined : analysisResult.input.loadCase, combination: analysisResult.input.combination,
            nodes: analysisResult.nodes, members: analysisResult.members, service: analysisResult.service,
            discretization: analysisResult.discretization ? { ...analysisResult.discretization, runs: analysisResult.discretization.runs.map(({ divisions, error }) => ({ divisions, error })) } : undefined } };
      }).catch((error): AiToolResult => {
        const execution = analysisExecutionRef.current.get(handle.ownerTaskId);
        const scheduled = analysisSchedulerRef.current.get(handle.ownerTaskId);
        if (scheduled?.status === "cancelled" || error instanceof AnalysisCancelledError || !execution || !isProjectCheckpointCurrent(execution.checkpoint, activeProjectRef.current, activeSessionRef.current, "exact")) return { status: "cancelled", message: "本地分析已取消，已确认模型和已有结果保留；可继续计算或修改条件后再次确认", context };
        if (error instanceof AnalysisFailure) { setAnalysisFailure({ failure: error, revision: execution.checkpoint.revision }); setStatus({ tone: "error", text: `${ANALYSIS_STAGE_LABELS[error.stage]}失败 · ${error.diagnostics.length} 项诊断` }); }
        else setStatus({ tone: "error", text: error instanceof Error ? error.message : "分析失败" });
        return { status: "failed", message: `${error instanceof Error ? error.message : "分析失败"}。已确认模型保留；请检查诊断并准备新的条件阶段或继续计算`, context,
          data: error instanceof AnalysisFailure ? { stage: error.stage, diagnostics: error.diagnostics, service: error instanceof AnalysisServiceFailure ? error.run : undefined } : undefined };
      }).finally(() => {
        pendingAnalysisInputsRef.current.delete(handle.taskId);
        analysisHandlesRef.current.delete(handle.taskId);
        analysisExecutionRef.current.delete(handle.ownerTaskId);
        const pendingAnalysis = [...analysisHandlesRef.current.keys()].some((id) => analysisSchedulerRef.current.get(id)?.kind === "analysis");
        if (!pendingAnalysis) { setAnalysisBusy(false); setAnalysisPhase(null); }
      });
    } catch (error) {
      setAnalysisBusy(false); setAnalysisPhase(null); setStatus({ tone: "error", text: error instanceof Error ? error.message : "无法排队分析任务" });
      return { status: "failed", message: error instanceof Error ? error.message : "无法排队分析任务", context };
    }
  };

  const saveNodeEdit = (event: React.FormEvent) => { event.preventDefault(); if (!selectedNode) return; try { const updated = applyProjectEdits(project, [{ type: "update_node", id: selectedNode.id, position: { x: parseNumber(nodeDraft.x, "X 坐标"), y: parseNumber(nodeDraft.y, "Y 坐标"), z: parseNumber(nodeDraft.z, "Z 坐标") } }]).project; activateProject(updated, false); setStatus({ tone: "success", text: `已更新 ${selectedNode.label}` }); setFormError(null); } catch (error) { setFormError(error instanceof Error ? error.message : "更新节点失败"); } };
  const saveMemberEdit = (event: React.FormEvent) => { event.preventDefault(); if (!selectedMember) return; try { const updated = applyProjectEdits(project, [{ type: "update_member", id: selectedMember.id, changes: { startNodeId: memberDraft.startNodeId as NodeId, endNodeId: memberDraft.endNodeId as NodeId, materialId: memberDraft.materialId as MaterialId, sectionId: memberDraft.sectionId as SectionId, rotationDegrees: parseNumber(memberDraft.rotationDegrees, "截面转角"), ...(memberDraft.endReleases ? { endReleases: memberDraft.endReleases } : {}) } }]).project; activateProject(updated, false); setStatus({ tone: "success", text: `已更新 ${selectedMember.label}` }); setFormError(null); } catch (error) { setFormError(error instanceof Error ? error.message : "更新杆件失败"); } };
  const saveMaterialEdit = (event: React.FormEvent) => { event.preventDefault(); if (!selectedMaterial) return; try { const updated = updateMaterial(project, selectedMaterial.id, materialToNumbers(materialDraft)); activateProject(updated, false); setStatus({ tone: "success", text: `已更新材料 ${selectedMaterial.label}` }); setFormError(null); } catch (error) { setFormError(error instanceof Error ? error.message : "更新材料失败"); } };
  const saveSectionEdit = (event: React.FormEvent) => {
    event.preventDefault(); if (!selectedSection) return;
    try { setSectionEditor({ id: selectedSection.id, input: selectedSection.catalogBasis ? { ...selectedSection, name: sectionDraft.name } : selectedSection.geometry ? { name: sectionDraft.name, geometry: selectedSection.geometry } : sectionToNumbers(sectionDraft) }); setFormError(null); }
    catch (error) { setFormError(error instanceof Error ? error.message : "Invalid section"); }
  };
  const saveSupportEdit = (event: React.FormEvent) => { event.preventDefault(); if (!selectedSupport) return; try { activateProject(updateSupport(project, selectedSupport.id, supportNodeId as NodeId, supportRestraints), false); setStatus({ tone: "success", text: `已更新支座 ${selectedSupport.label}` }); setFormError(null); } catch (error) { setFormError(error instanceof Error ? error.message : "更新支座失败"); } };
  const saveLoadEdit = (event: React.FormEvent) => { event.preventDefault(); if (!selectedLoad) return; try {
    const force = { x: parseNumber(loadDraft.fx, "FX"), y: parseNumber(loadDraft.fy, "FY"), z: parseNumber(loadDraft.fz, "FZ") };
    const moment = { x: parseNumber(loadDraft.mx, "MX"), y: parseNumber(loadDraft.my, "MY"), z: parseNumber(loadDraft.mz, "MZ") };
    activateProject(selectLoadCase(updateNodalLoad(project, selectedLoad.id, loadDraft.nodeId as NodeId, force, moment, loadDraft.loadCaseId), loadDraft.loadCaseId), false); setStatus({ tone: "success", text: `已更新荷载 ${selectedLoad.label}` }); setFormError(null);
  } catch (error) { setFormError(error instanceof Error ? error.message : "更新荷载失败"); } };

  const toggleMultiSelection = (kind: "node" | "member", id: string) => {
    const setter = kind === "node" ? setSelectedNodeIds : setSelectedMemberIds;
    setter((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const duplicateSelected = (kind: "node" | "member") => {
    try {
      if (kind === "node") {
        const ids = [...selectedNodeIds] as NodeId[]; if (!ids.length) return;
        const count = project.nodes.length; const updated = applyProjectEdits(project, ids.map((id) => ({ type: "duplicate_node", id }))).project; activateProject(updated, false); const copies = updated.nodes.slice(count); setSelectedNodeIds(new Set(copies.map((item) => item.id))); selectObject(copies.at(-1) ? { kind: "node", id: copies.at(-1)!.id } : null, updated); setStatus({ tone: "success", text: `已复制 ${copies.length} 个节点` });
      } else {
        const ids = [...selectedMemberIds] as MemberId[]; if (!ids.length) return;
        const count = project.members.length; const updated = applyProjectEdits(project, ids.map((id) => ({ type: "duplicate_member", id }))).project; activateProject(updated, false); const copies = updated.members.slice(count); setSelectedMemberIds(new Set(copies.map((item) => item.id))); selectObject(copies.at(-1) ? { kind: "member", id: copies.at(-1)!.id } : null, updated); setStatus({ tone: "success", text: `已复制 ${copies.length} 个杆件` });
      }
    } catch (error) { setStatus({ tone: "error", text: error instanceof Error ? error.message : "复制失败" }); }
  };
  const deleteSelected = (kind: "node" | "member") => {
    try {
      if (kind === "node") {
        const ids = [...selectedNodeIds] as NodeId[]; if (!ids.length) return;
        const updated = applyProjectEdits(project, ids.map((id) => ({ type: "delete_node", id }))).project; activateProject(updated, false); setSelectedNodeIds(new Set()); setSelectedMemberIds((current) => new Set([...current].filter((id) => updated.members.some((member) => member.id === id)))); setSelection(null); setStatus({ tone: "success", text: `已删除 ${ids.length} 个节点及其关联对象` });
      } else {
        const ids = [...selectedMemberIds] as MemberId[]; if (!ids.length) return;
        const updated = applyProjectEdits(project, ids.map((id) => ({ type: "delete_member", id }))).project; activateProject(updated, false); setSelectedMemberIds(new Set()); setSelection(null); setStatus({ tone: "success", text: `已删除 ${ids.length} 个杆件` });
      }
    } catch (error) { setStatus({ tone: "error", text: error instanceof Error ? error.message : "删除失败" }); }
  };
  const openBatchEdit = (kind: "node" | "member") => { setBatchDraft({ x: "0", y: "0", z: "0", rotationDegrees: "0" }); setFormError(null); setBatchDialog(kind); };
  const submitBatchEdit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (batchDialog === "node") {
        const offset = { x: parseNumber(batchDraft.x, "X 偏移"), y: parseNumber(batchDraft.y, "Y 偏移"), z: parseNumber(batchDraft.z, "Z 偏移") };
        const updated = applyProjectEdits(project, [...selectedNodeIds].map((id) => { const node = project.nodes.find((item) => item.id === id)!; return { type: "update_node", id: id as NodeId, position: { x: node.position.x + offset.x, y: node.position.y + offset.y, z: node.position.z + offset.z } }; })).project;
        activateProject(updated, false); selectObject(selection, updated); setBatchDialog(null); setFormError(null); setStatus({ tone: "success", text: `已批量移动 ${selectedNodeIds.size} 个节点` });
      } else if (batchDialog === "member") {
        const rotationDegrees = parseNumber(batchDraft.rotationDegrees, "截面转角");
        const updated = applyProjectEdits(project, [...selectedMemberIds].map((id) => ({ type: "update_member", id: id as MemberId, changes: { rotationDegrees } }))).project;
        activateProject(updated, false); selectObject(selection, updated); setBatchDialog(null); setFormError(null); setStatus({ tone: "success", text: `已批量修改 ${selectedMemberIds.size} 个杆件` });
      }
    } catch (error) { setFormError(error instanceof Error ? error.message : "批量修改失败"); }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!startupReady) return;
      if (event.key === "Escape") { setFileMenuOpen(false); return; }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (!["n", "o", "s", "z", "y"].includes(key)) return;
      event.preventDefault();
      setFileMenuOpen(false);
      if (key === "n") beginNewProject();
      if (key === "o") void openProject();
      if (key === "s") void saveProject();
      if (key === "z") restoreHistory(event.shiftKey ? "redo" : "undo");
      if (key === "y") restoreHistory("redo");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  useEffect(() => () => {
    const activeAnalysis = analysisTaskRef.current;
    analysisSchedulerRef.current.cancelProject(activeProjectRef.current.id);
    if (!activeAnalysis) return;
    analysisRunRef.current += 1;
    analysisTaskRef.current = null;
    activeAnalysis.task.cancel();
  }, []);

  useEffect(() => {
    if (!startupReady) return;
    captureRecoveryRef.current = () => {
      const current = activeProjectRef.current;
      if (current.revision === 0 && !current.taskState?.conversations.length && !current.taskState?.scheduled.length && !current.taskState?.analyses.length) return;
      const request = { content: encodeProject(current), formalSave: formalSaveRef.current };
      recoveryAutosave.capture(current.id, request);
    };
    if (recoveryTimerRef.current === null) recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null; captureRecoveryRef.current();
    }, 250);
  }, [project, formalSave, startupReady]);

  useEffect(() => {
    if (!startupReady) return;
    const interval = window.setInterval(() => { captureRecoveryRef.current(); recoveryAutosave.retryFailed(); }, 2000);
    return () => {
      window.clearInterval(interval);
      if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    };
  }, [startupReady]);

  if (!startupReady) return <StartupRecovery onContinue={() => setStartupReady(true)} onRecover={(restored, entry) => {
    activateProject(restored, true); setProjectPath(entry.formalSave?.path ?? null); setFormalSave(entry.formalSave);
    setSavedProject(null); setSavedRevision(-1); setRecoverySource(entry); setStartupReady(true);
    setStatus({ tone: "neutral", text: "已恢复自动快照；当前工作尚未手动保存，任务等待用户选择继续" });
  }} />;

  return <UnitPresetContext.Provider value={project.displayUnitPreset ?? "m-kN"}><main className="app-shell">
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
        <nav className="task-tabs" role="tablist" aria-label="工作任务">
        <button className="task-tab active" role="tab" aria-selected="true">建模</button>
        {(["荷载", "分析", "结果"] as const).map((task) => <button className="task-tab" role="tab" aria-selected="false" disabled title={`${task}请使用当前任务工具`} key={task}>{task}</button>)}
        </nav>
      </div>
      <div className="document-title"><span>{project.name}</span>{dirty && <span className="dirty-dot" aria-label="未保存修改" />}<small>{recoverySource ? "自动快照 · 未保存" : filename(projectPath) ?? "未保存项目"}</small></div>
      <div className="layout-controls" role="group" aria-label="面板布局">
        <select className="unit-preset-selector" aria-label="单位预设" value={project.displayUnitPreset ?? "m-kN"} onChange={(event) => { const next = { ...activeProjectRef.current, displayUnitPreset: requireUnitPreset(event.target.value) }; activeProjectRef.current = next; setProject(next); }}>{Object.entries(UNIT_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}</select>
        <button className={`icon-button ${resourcePanelOpen ? "active" : ""}`} aria-label="切换资源管理器" aria-pressed={resourcePanelOpen} aria-controls={sidebarModule === "project" ? "resource-panel" : `${sidebarModule}-panel`} title={resourcePanelOpen ? "收起资源管理器" : "展开资源管理器"} onClick={() => setResourcePanelOpen((open) => !open)}><PanelLeft size={15} /></button>
        <button className={`icon-button ${propertyPanelOpen ? "active" : ""}`} aria-label="切换属性面板" aria-pressed={propertyPanelOpen} aria-controls="property-panel" title={propertyPanelOpen ? "收起属性面板" : "展开属性面板"} onClick={() => setPropertyPanelOpen((open) => !open)}><Table2 size={15} /></button>
        <button className={`icon-button ${assistantPanelOpen ? "active" : ""}`} aria-label="切换 AI 对话" aria-pressed={assistantPanelOpen} aria-controls="assistant-panel" title={assistantPanelOpen ? "收起 AI 对话" : "展开 AI 对话"} onClick={() => setAssistantPanelOpen((open) => !open)}><PanelRight size={15} /></button>
      </div>
    </header>

    <section className="task-toolbar" aria-label="当前任务工具" aria-busy={analysisBusy} data-analysis-phase={analysisPhase ?? undefined} data-history-version={historyVersion}>
      <span className="task-context">建模</span><span className="toolbar-divider" />
      <div className="model-toolbar" role="toolbar" aria-label="建模工具">
        <button className={`tool-button${drawingEnabled ? "" : " active"}`} aria-label="选择" aria-pressed={!drawingEnabled} title="选择对象" onClick={() => { setDrawingEnabled(false); selectObject(null); }}><MousePointer2 size={15} />选择</button>
        <button className={`tool-button${drawingEnabled ? " active" : ""}`} aria-label="工作平面绘杆" aria-pressed={drawingEnabled} onClick={() => { setResultView("model"); setDrawingEnabled((value) => !value); selectObject(null); }}><Crosshair size={15} />绘杆</button>
        <button className="tool-button" onClick={openNodeDialog} aria-label="创建节点" title="创建节点"><CircleDot size={15} />节点</button>
        <button className="tool-button" disabled={!project.members.length} aria-label="显式连接与工程分割" onClick={() => { setDrawingEnabled(false); setTopologyOpen(true); }}><Link2 size={15} />连接／分割</button>
        <button className="tool-button" aria-label="参数化截面管理" onClick={() => { setDrawingEnabled(false); setSectionEditor({}); }}><Box size={15} />参数截面</button>
        <button className="tool-button" disabled={project.nodes.length < 2} aria-label="近重合检查与节点合并" onClick={() => { setDrawingEnabled(false); setNodeMergeOpen(true); }}><Link2 size={15} />节点合并</button>
        <button className="tool-button" aria-disabled={!memberCreationAvailable} onClick={memberCreationAvailable ? openMemberDialog : undefined} aria-label="创建杆件" title={memberCreationAvailable ? "创建杆件" : "需要至少两个节点、一个材料和一个截面"}><Link2 size={15} />杆件</button>
        <button className="tool-button" onClick={() => { setMaterialDraft(defaultMaterial); setSectionDraft(defaultSection); setMaterialCatalogId(""); setSectionCatalogId(""); setFormError(null); setResourceDialogOpen(true); }} aria-label="创建材料与截面" title="创建材料与截面"><Layers3 size={15} />材料与截面</button>
        <button className="tool-button" aria-label="支座" title="创建节点支座" onClick={openSupportDialog}><Anchor size={15} />支座</button>
        <LoadMenu disabled={!!activeCombination} hasMembers={project.members.length > 0}
          onNodalLoad={openLoadDialog}
          onUniformLoad={() => { setUniformDraft({ ...defaultUniform, loadCaseId: activeCase.id, memberId: selectedMember?.id ?? project.members[0]?.id ?? "" }); setFormError(null); setUniformDialogOpen(true); }}
          onLoadCases={() => setLoadCaseManagerOpen(true)} />
        {analysisBusy ? <button className="tool-button" aria-label="取消计算" title="取消正在运行的分析任务" onClick={cancelAnalysis}><X size={15} />取消计算</button> : <button className="tool-button" aria-label="运行分析" title="使用 C++ 核心运行空间刚架静力分析" onClick={() => void runAnalysis()}><Calculator size={15} />计算</button>}
        {taskQueue.queued.length > 0 && <span className="task-queue-summary" role="status" aria-label={`等待中的任务 ${taskQueue.queued.length}`}>队列 {taskQueue.queued.length} · 启动时读取最新模型</span>}
        <span className="toolbar-divider" />
        <button className="tool-button icon-only" disabled={!projectHistoryRef.current.canUndo} aria-label={projectHistoryRef.current.canUndo ? "撤销" : "撤销（尚未实现）"} title="撤销（Ctrl+Z）" onClick={() => restoreHistory("undo")}><Undo2 size={15} /></button>
        <button className="tool-button icon-only" disabled={!projectHistoryRef.current.canRedo} aria-label={projectHistoryRef.current.canRedo ? "重做" : "重做（尚未实现）"} title="重做（Ctrl+Y）" onClick={() => restoreHistory("redo")}><Redo2 size={15} /></button>
      </div>
    </section>

    <ResizableWorkspace resourceOpen={resourcePanelOpen} assistantOpen={assistantPanelOpen} resourcePanelId={sidebarModule === "project" ? "resource-panel" : `${sidebarModule}-panel`}>
      <nav className="activity-bar" aria-label="侧边导航">
        <button className={`activity-button ${resourcePanelOpen && sidebarModule === "project" ? "active" : ""}`} aria-label="资源管理器" aria-pressed={resourcePanelOpen && sidebarModule === "project"} aria-controls="resource-panel" title="资源管理器" onClick={() => switchSidebarModule("project")}><Files size={22} strokeWidth={1.5} /></button>
        <button className={`activity-button ${resourcePanelOpen && sidebarModule === "search" ? "active" : ""}`} aria-label="搜索" aria-pressed={resourcePanelOpen && sidebarModule === "search"} aria-controls="search-panel" title="搜索" onClick={() => switchSidebarModule("search")}><Search size={22} strokeWidth={1.5} /></button>
        <button className={`activity-button ${resourcePanelOpen && sidebarModule === "library" ? "active" : ""}`} aria-label="资源库" aria-pressed={resourcePanelOpen && sidebarModule === "library"} aria-controls="library-panel" title="资源库" onClick={() => switchSidebarModule("library")}><Library size={22} strokeWidth={1.5} /></button>
        <button className="activity-button activity-settings" aria-label="设置" aria-haspopup="dialog" aria-expanded={settingsDialogOpen} aria-controls="settings-dialog" title="设置" onClick={() => setSettingsDialogOpen(true)}><Settings size={22} strokeWidth={1.5} /></button>
      </nav>
      <aside id="resource-panel" className="project-panel" aria-label="项目资源" hidden={!resourcePanelOpen || sidebarModule !== "project"}>
        <section className="sidebar-pane project-tree-pane" aria-label="项目树"><div className="panel-heading"><span>项目</span><button className="icon-button" title="添加节点" onClick={openNodeDialog}><Plus size={16} /></button></div>
          <div className="load-case-selector"><label><span>分析工况</span><select aria-label="当前分析工况" value={project.activeAnalysisCaseId ?? ""} onChange={(e) => { activateProject(e.target.value ? selectAnalysisCase(project, e.target.value) : selectAnalysisSource(project, project.activeLoadCombinationId ?? project.activeLoadCaseId), false); setHistoryAnalysisId(undefined); setSelection(null); }}><option value="">直接计算荷载定义</option>{project.analysisCases.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}</select></label><button className="icon-button" aria-label="管理分析工况" title="分析工况管理" onClick={() => setAnalysisCaseManagerOpen(true)}><Settings2 size={15} /></button></div>
          <div className="load-case-selector"><label><span>当前工况</span><select aria-label="当前工况" value={activeCombination ? "" : activeCase.id} onChange={(event) => { activateProject(selectLoadCase(project, event.target.value), false); setSelection(null); setFormError(null); setStatus({ tone: "neutral", text: `当前工况 · ${event.target.value}` }); }}>{activeCombination && <option value="" disabled>组合模式</option>}{project.loadCases.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label><button className="icon-button" aria-label="管理工况" title="管理荷载工况" onClick={() => setLoadCaseManagerOpen(true)}><Settings2 size={15} /></button></div>
          <div className="load-case-selector"><label><span>当前组合</span><select aria-label="当前组合" value={project.activeLoadCombinationId ?? ""} onChange={(event) => { activateProject(event.target.value ? selectLoadCombination(project, event.target.value) : selectLoadCase(project, activeCase.id), false); setSelection(null); setFormError(null); }}><option value="">独立工况</option>{project.loadCombinations.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label><button className="icon-button" aria-label="管理组合" title="管理自定义荷载组合" onClick={() => setLoadCombinationManagerOpen(true)}><Layers3 size={15} /></button></div>
          <div className="project-tree"><div className="tree-root"><ChevronDown size={14} /><Box size={15} /><span>{project.name}</span></div>
          <TreeGroup label="节点" count={project.nodes.length} icon={<CircleDot size={14} />}>
            <PagedItems items={project.nodes} label="节点列表">{(items) => <>{items.map((node) => <div className="tree-object" key={node.id}><input type="checkbox" aria-label={`选择节点 ${node.label}`} checked={selectedNodeIds.has(node.id)} onChange={() => { toggleMultiSelection("node", node.id); setPropertyPanelOpen(true); }} /><button className={`tree-item ${selection?.kind === "node" && selection.id === node.id || selectedNodeIds.has(node.id) ? "selected" : ""}`} onClick={() => selectObject({ kind: "node", id: node.id })}><span className="node-glyph" /><span>{node.label}</span><small>{node.position.x}, {node.position.y}, {node.position.z}</small></button></div>)}</>}</PagedItems>
            {project.nodes.length === 0 && <p className="tree-empty">暂无节点</p>}
          </TreeGroup>
          <TreeGroup label="杆件" count={project.members.length} icon={<Link2 size={14} />}>
            <PagedItems items={project.members} label="杆件列表">{(items) => <>{items.map((member) => <div className="tree-object" key={member.id}><input type="checkbox" aria-label={`选择杆件 ${member.label}`} checked={selectedMemberIds.has(member.id)} onChange={() => { toggleMultiSelection("member", member.id); setPropertyPanelOpen(true); }} /><button className={`tree-item ${selection?.kind === "member" && selection.id === member.id || selectedMemberIds.has(member.id) ? "selected" : ""}`} onClick={() => selectObject({ kind: "member", id: member.id })}><span className="member-glyph" /><span>{member.label}</span><small>{member.startNodeId.replace("node_", "N")} → {member.endNodeId.replace("node_", "N")}</small></button></div>)}</>}</PagedItems>
            {project.members.length === 0 && <p className="tree-empty">暂无杆件</p>}
          </TreeGroup>
          <TreeGroup label="材料与截面" count={project.materials.length + project.sections.length} icon={<Layers3 size={14} />}>
            {project.materials.map((material) => <button className={`tree-item resource ${selection?.kind === "material" && selection.id === material.id ? "selected" : ""}`} key={material.id} onClick={() => selectObject({ kind: "material", id: material.id })}><span className="material-glyph" /><span>材料 {material.label} · {material.name}</span></button>)}
            {project.sections.map((section) => <button className={`tree-item resource ${selection?.kind === "section" && selection.id === section.id ? "selected" : ""}`} key={section.id} onClick={() => selectObject({ kind: "section", id: section.id })}><span className="section-glyph" /><span>截面 {section.label} · {section.name}</span></button>)}
          </TreeGroup>
          <TreeGroup label="支座" count={project.supports.length} icon={<Anchor size={14} />}>
            <PagedItems items={project.supports} label="支座列表">{(items) => <>{items.map((support) => <button className={`tree-item resource ${selection?.kind === "support" && selection.id === support.id ? "selected" : ""}`} key={support.id} onClick={() => selectObject({ kind: "support", id: support.id })}><span className="material-glyph" /><span>{support.label} · {project.nodes.find((node) => node.id === support.nodeId)?.label ?? support.nodeId}</span></button>)}</>}</PagedItems>
            {project.supports.length === 0 && <p className="tree-empty">暂无支座</p>}
          </TreeGroup>
          {activeCombination ? <TreeGroup label={`用户定义 · ${activeCombination.id}`} count={activeCombination.terms.length} icon={<Layers3 size={14} />}>
            {activeCombination.terms.map((term) => <button className="tree-item combination-case" key={term.loadCaseId} title={`查看 ${term.loadCaseId} 工况输入`} onClick={() => { activateProject(selectLoadCase(project, term.loadCaseId), false); setSelection(null); }}><Layers3 size={13} /><span>{term.loadCaseId} · {project.loadCases.find((item) => item.id === term.loadCaseId)?.name}</span><small>× {term.factor}</small></button>)}
          </TreeGroup> : <><TreeGroup label={`节点荷载 · ${activeCase.id}`} count={caseLoads.length} icon={<Plus size={14} />}>
            <PagedItems items={caseLoads} label="节点荷载列表">{(items) => <>{items.map((load) => <button className={`tree-item resource ${selection?.kind === "load" && selection.id === load.id ? "selected" : ""}`} key={load.id} onClick={() => selectObject({ kind: "load", id: load.id })}><span className="section-glyph" /><span>{load.label} · {project.nodes.find((node) => node.id === load.nodeId)?.label ?? load.nodeId}</span></button>)}</>}</PagedItems>
            {caseLoads.length === 0 && <p className="tree-empty">暂无节点荷载</p>}
          </TreeGroup>
          <TreeGroup label={`杆件均布荷载 · ${activeCase.id}`} count={caseUniformLoads.length} icon={<ArrowDownToLine size={14} />}>
            <PagedItems items={caseUniformLoads} label="均布荷载列表">{(items) => <>{items.map((load) => <button className={`tree-item resource ${selection?.kind === "uniform-load" && selection.id === load.id ? "selected" : ""}`} key={load.id} onClick={() => selectObject({ kind: "uniform-load", id: load.id })}><ArrowDownToLine size={14} /><span>{load.label} · {project.members.find((member) => member.id === load.memberId)?.label}</span></button>)}</>}</PagedItems>
            {caseUniformLoads.length === 0 && <p className="tree-empty">暂无均布荷载</p>}
          </TreeGroup>
          <TreeGroup label={`结构自重 · ${activeCase.id}`} count={caseSelfWeightEnabled ? 1 : 0} icon={<Weight size={14} />}>
            <button className="tree-item resource case-self-weight" aria-label={`结构自重 ${activeCase.id}`} onClick={() => openSelfWeightDialog(activeCase.id)}><Weight size={14} /><span>{caseSelfWeightEnabled ? "已启用 · g" : "未启用"}</span><small>{project.selfWeight.loadCaseId === activeCase.id ? u.vector(project.selfWeight.gravity, "m/s²") : `归属 ${project.selfWeight.loadCaseId}`}</small></button>
          </TreeGroup>
          </>}
          <TreeGroup label="荷载工况与组合" count={project.loadCases.length + project.loadCombinations.length} icon={<Layers3 size={14} />}>
            {project.loadCases.map((item) => <button key={item.id} className={`tree-item resource ${!activeCombination && activeCase.id === item.id ? "active-source" : ""}`} aria-label={`切换工况 ${item.id}`} onClick={() => { activateProject(selectLoadCase(project, item.id), false); selectObject(null); }}><Layers3 size={14} /><span>{item.id} · {item.name}</span></button>)}
            {project.loadCombinations.map((item) => <button key={item.id} className={`tree-item resource ${activeCombination?.id === item.id ? "active-source" : ""}`} aria-label={`切换组合 ${item.id}`} onClick={() => { activateProject(selectLoadCombination(project, item.id), false); selectObject(null); }}><Layers3 size={14} /><span>{item.id} · {item.name} · 用户定义</span></button>)}
          </TreeGroup>
          <TreeGroup label="计算结果" count={project.analysisResults.length} icon={<Calculator size={14} />}>
            <button className={`tree-item case-result ${caseResult && !selection ? "selected" : ""}`} aria-label="查看分析结果" disabled={!caseResult} onClick={() => { setResultReference(null); setResultFocus(null); selectObject(null); setPropertyPanelOpen(true); }}><Calculator size={14} /><span>分析结果 · {caseResult ? getAnalysisSourceId(caseResult.input) : activeSource.id}</span><small>{caseResult ? resultIsCurrent(caseResult) ? "当前" : "已过期" : "未计算"}</small></button>
            <button className="tree-item resource" disabled={project.analysisResults.length < 2} onClick={() => setComparisonOpen(true)}><Files size={14} /><span>历史分析与前后对比</span></button>
            {resultSources.map((source) => {
              const result = getAnalysisResultForSource(project, source.id);
              return result && <button key={source.id} className="tree-item resource" aria-label={`查看 ${source.id} 结果`} onClick={() => { activateProject(selectAnalysisSource(project, source.id), false); setHistoryAnalysisId(undefined); selectObject(null); setPropertyPanelOpen(true); }}><Calculator size={14} /><span>{source.id} · {resultIsCurrent(result) ? "当前" : "已过期"} · R{result.projectRevision}</span></button>;
            })}
            {project.analysisResults.length === 0 && <p className="tree-empty">尚无已完成分析</p>}
          </TreeGroup>
          <button className="tree-item resource" onClick={() => setReportOpen(true)}><Files size={14} /><span>工程计算书</span></button>
          </div>
        </section>
      </aside>


      <aside id="search-panel" className="module-panel" aria-label="搜索" hidden={!resourcePanelOpen || sidebarModule !== "search"}>
        <div className="panel-heading"><span>搜索</span></div>
        <div className="module-empty"><Search size={26} strokeWidth={1.5} /><span>暂未开放</span></div>
      </aside>
      <aside id="library-panel" className="module-panel" aria-label="资源库" hidden={!resourcePanelOpen || sidebarModule !== "library"}>
        <ResourceLibraryPanel onImport={importLibraryResource} />
      </aside>

      <section className={`model-area ${analysisFailure ? "has-diagnostics" : ""}`}>
        {analysisFailure && <section className="analysis-diagnostics" aria-label="分析诊断">
          <header><strong>{ANALYSIS_STAGE_LABELS[analysisFailure.failure.stage]}失败</strong><span>R{analysisFailure.revision} · {analysisFailure.revision === project.revision ? "当前模型" : "模型已修改，待重新检查"}</span><button className="icon-button" aria-label="关闭分析诊断" title="关闭分析诊断" onClick={() => setAnalysisFailure(null)}><X size={15} /></button></header>
          <ul>{analysisFailure.failure.diagnostics.map((diagnostic, index) => {
            const target = diagnostic.target;
            const objects = target?.kind === "node" ? project.nodes : target?.kind === "member" ? project.members : target?.kind === "material" ? project.materials : target?.kind === "section" ? project.sections : target?.kind === "support" ? project.supports : target?.kind === "uniform-load" ? project.uniformLoads : target?.kind === "load" ? project.nodalLoads : [];
            const object = target?.kind !== "self-weight" && target ? objects.find((item) => item.id === target.id) : undefined;
            const fieldLabel = diagnostic.field ? ANALYSIS_FIELD_LABELS[diagnostic.field] ?? diagnostic.field : diagnostic.dof?.toUpperCase() ?? "对象";
            return <li key={index}><div><p>{diagnostic.message}</p>{diagnostic.position !== undefined && <small>工程杆件沿杆位置 {diagnostic.position.toPrecision(6)} m</small>}{diagnostic.evidence && <small>主元 {diagnostic.evidence.pivotMagnitude.toExponential(3)} · 阈值 {diagnostic.evidence.threshold.toExponential(3)} · 矩阵尺度 {diagnostic.evidence.matrixScale.toExponential(3)} · 全局索引 {diagnostic.evidence.globalDofIndex}（从 0 起）</small>}</div>
              {target?.kind === "load-combination" && <button className="diagnostic-location" aria-label={`定位组合 ${target.id}`} title="打开荷载工况与组合设置" onClick={() => setLoadCaseManagerOpen(true)}><Crosshair size={14} /><span>{target.id} · {fieldLabel}</span></button>}
              {target?.kind === "self-weight" ? <button className="diagnostic-location" aria-label="定位自重设置" title="打开自重设置" onClick={() => openSelfWeightDialog()}><Crosshair size={14} /><span>自重设置 · {fieldLabel}</span></button> : target && object && <button className="diagnostic-location" aria-label={`定位 ${object.label} · ${fieldLabel}`} title={`定位 ${object.label} · ${fieldLabel}`} onClick={() => { selectObject(target); setDiagnosticFitRequest((value) => value + 1); }}><Crosshair size={14} /><span>{object.label} · {fieldLabel}</span></button>}
            </li>;
          })}</ul>
        </section>}
        <SceneViewport theme={theme} supports={project.supports} nodalLoads={caseResult?.modal || activeAnalysisCase?.method === "modal" ? [] : activeCombination ? combinationInput?.nodalLoads ?? [] : caseLoads} conditionSelection={selection?.kind === "support" || selection?.kind === "load" ? selection : null} onSelectCondition={(next) => { if (next.kind === "support" || !activeCombination) selectObject(next); }}
          selfWeight={caseResult?.modal || activeAnalysisCase?.method === "modal" ? undefined : activeCombination ? combinationInput?.selfWeight : caseSelfWeightEnabled ? project.selfWeight : undefined} selfWeightLabel={`${activeSource.id} · ${activeSource.name}${activeCombination ? " · 组合加权" : ""}`}
          drawingEnabled={drawingEnabled} drawingReset={drawingReset} onExitDrawing={() => setDrawingEnabled(false)} onDrawSegment={(input) => {
            const updated = applyProjectEdits(project, prepareDrawnMemberEdits(project, input)).project;
            activateProject(updated, false);
            const member = updated.members.at(-1)!;
            setStatus({ tone: "success", text: `已绘制 ${member.label} · 可整体撤销` });
            return updated.nodes.find((node) => node.id === member.endNodeId)!;
          }}
          preview={aiPreview} projectId={project.id} nodes={project.nodes} members={project.members} materials={project.materials} sections={project.sections} analysis={displayedResult} resultView={caseResult?.modal && resultView === "forces" ? "model" : resultView} forceComponent={forceComponent} deformationScale={deformationScale} resultFocus={resultFocus} uniformLoads={caseResult?.modal || activeAnalysisCase?.method === "modal" ? [] : activeCombination ? combinationInput?.uniformLoads ?? [] : caseUniformLoads} sourceLabel={`${caseResult ? analysisSourceLabel(caseResult) : `${activeSource.id} · ${activeSource.name}`} · ${caseResult ? resultIsCurrent(caseResult) ? "结果当前" : "结果已过期" : "未计算"}`} selectedUniformLoadId={activeCombination ? undefined : selectedUniform?.id} onSelectUniformLoad={activeCombination ? undefined : (id) => selectObject({ kind: "uniform-load", id })} fitRequest={diagnosticFitRequest} selection={selection?.kind === "node" || selection?.kind === "member" ? selection : selectedUniform ? { kind: "member", id: selectedUniform.memberId } : selectedSupport || selectedLoad ? { kind: "node", id: (selectedSupport ?? selectedLoad)!.nodeId } : null} onSelect={selectObject} />
        <BottomProperties open={propertyPanelOpen} label={currentSelectionLabel} onClose={() => setPropertyPanelOpen(false)}>
          {(selectedNodeIds.size > 0 || selectedMemberIds.size > 0) && <div className="property-selection-actions">{(["node", "member"] as const).map((kind) => {
            const count = kind === "node" ? selectedNodeIds.size : selectedMemberIds.size;
            return count > 0 && <div key={kind} role="group" aria-label={kind === "node" ? "选中节点操作" : "选中杆件操作"}><span>{kind === "node" ? "节点" : "杆件"} · {count} 已选</span><button className="selection-action" onClick={() => openBatchEdit(kind)}>批量修改</button><button className="selection-action" onClick={() => duplicateSelected(kind)}>复制选中</button><button className="selection-action danger" onClick={() => deleteSelected(kind)}>删除选中</button></div>;
          })}</div>}
          {resultReference && referenceAnalysis && <ResultReferenceDetails reference={resultReference} current={resultIsCurrent(referenceAnalysis)}
            exists={(resultReference.object.kind === "node" ? project.nodes : project.members).some((item) => item.id === resultReference.object.id)}
            onClose={() => { setResultReference(null); setResultFocus(null); }} />}
          {selectedNode && <Inspector title="空间节点" label={selectedNode.label} icon={<CircleDot size={15} />} id={selectedNode.id}>
            <AdditionalMassEditor key={`${selectedNode.id}:${selectedNode.additionalMassKg ?? 0}`} kind="point" value={selectedNode.additionalMassKg ?? 0} onCommit={(massKg) => {
              const next = applyProjectEdits(project, [{ type: "set_node_mass", id: selectedNode.id, massKg }]).project;
              activateProject(next, false); setStatus({ tone: "success", text: "附加点质量已保存，相关模态结果需重算" });
            }} />
            <section className="property-section"><h3>当前全局坐标</h3><dl className="coordinates-list">{(["x", "y", "z"] as const).map((axis) => <div key={axis}><dt>{axis.toUpperCase()}</dt><dd>{u.quantity(selectedNode.position[axis], "m")}</dd></div>)}</dl></section>
            <form className="property-form" onSubmit={saveNodeEdit}><h3>全局坐标</h3>{(["x", "y", "z"] as const).map((axis) => <NumberField key={axis} label={`${axis.toUpperCase()} 坐标`} value={nodeDraft[axis]} onChange={(value) => setNodeDraft({ ...nodeDraft, [axis]: value })} unit="m" />)}<FormFeedback error={formError} /><button className="button primary" type="submit">保存节点属性</button></form>
          </Inspector>}
          {selectedMember && memberGeometry && <Inspector title="空间刚架杆件" label={selectedMember.label} icon={<Link2 size={15} />} id={selectedMember.id}>
            <AdditionalMassEditor key={`${selectedMember.id}:${selectedMember.additionalLineMassKgM ?? 0}`} kind="line" value={selectedMember.additionalLineMassKgM ?? 0} onCommit={(additionalLineMassKgM) => {
              const next = applyProjectEdits(project, [{ type: "update_member", id: selectedMember.id, changes: { additionalLineMassKgM } }]).project;
              activateProject(next, false); setStatus({ tone: "success", text: "附加线质量已保存，相关模态结果需重算" });
            }} />
            <section className="property-section"><h3>几何</h3><dl><div><dt>长度</dt><dd>{u.quantity(memberGeometry.length, "m")}</dd></div></dl><details><summary>局部坐标与参考轴</summary><dl><div><dt>局部 x</dt><dd>{vectorText(memberGeometry.localX)}</dd></div><div><dt>局部 y</dt><dd>{vectorText(memberGeometry.localY)}</dd></div><div><dt>局部 z</dt><dd>{vectorText(memberGeometry.localZ)}</dd></div><div><dt>参考轴</dt><dd>{memberGeometry.referenceAxis === "global-z" ? "全局 Z" : "全局 Y（竖杆回退）"}</dd></div></dl></details></section>

            <form className="property-form" onSubmit={saveMemberEdit}><h3>连接与朝向</h3><SelectField label="起点节点" value={memberDraft.startNodeId} onChange={(value) => setMemberDraft({ ...memberDraft, startNodeId: value })} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><SelectField label="终点节点" value={memberDraft.endNodeId} onChange={(value) => setMemberDraft({ ...memberDraft, endNodeId: value })} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><SelectField label="材料" value={memberDraft.materialId} onChange={(value) => setMemberDraft({ ...memberDraft, materialId: value })} options={project.materials.map((item) => ({ value: item.id, label: `${item.label} · ${item.name}` }))} /><SelectField label="截面" value={memberDraft.sectionId} onChange={(value) => setMemberDraft({ ...memberDraft, sectionId: value })} options={project.sections.map((item) => ({ value: item.id, label: `${item.label} · ${item.name}` }))} /><NumberField label="截面转角（°）" value={memberDraft.rotationDegrees} onChange={(value) => setMemberDraft({ ...memberDraft, rotationDegrees: value })} unit="°" /><MemberReleaseFields value={memberDraft.endReleases} onChange={(endReleases) => setMemberDraft({ ...memberDraft, endReleases })} /><div className="assignment-summary"><span>{project.materials.find((item) => item.id === selectedMember.materialId)?.name}</span><span>{project.sections.find((item) => item.id === selectedMember.sectionId)?.name}</span></div><FormFeedback error={formError} /><button className="button primary" type="submit">保存杆件属性</button></form>
            {caseResult && !caseResult.modal && <MemberAnalysisProcess result={caseResult} memberId={selectedMember.id} memberLabel={selectedMember.label} resultIsCurrent={resultIsCurrent(caseResult)} />}
          </Inspector>}
          {selectedMaterial && <Inspector title={selectedMaterial.provenance.kind === "catalog" ? "库材料" : "自定义材料"} label={`${selectedMaterial.label} · ${selectedMaterial.name}`} icon={<Layers3 size={15} />} id={selectedMaterial.id}><ResourceProvenanceView provenance={selectedMaterial.provenance} /><MaterialFields draft={materialDraft} setDraft={setMaterialDraft} /><FormFeedback error={formError} /><button className="button primary inspector-save" onClick={(event) => void saveMaterialEdit(event)}>保存材料属性</button></Inspector>}
          {selectedSection && <Inspector title={selectedSection.provenance.kind === "catalog" ? "库截面" : "自定义截面"} label={`${selectedSection.label} · ${selectedSection.name}`} icon={<Box size={15} />} id={selectedSection.id}><ResourceProvenanceView provenance={selectedSection.provenance} /><SectionFieldNotes /><SectionGeometryPreview geometry={selectedSection.geometry} /><SectionBasisView section={selectedSection} />{selectedSection.geometry ? <button className="button" onClick={() => setSectionEditor({ id: selectedSection.id })}>编辑尺寸与共享影响</button> : <SectionFields draft={sectionDraft} setDraft={setSectionDraft} />}<FormFeedback error={formError} /><button className="button primary inspector-save" onClick={(event) => void saveSectionEdit(event)}>保存截面属性</button></Inspector>}
          {selectedSupport && <Inspector title="节点支座" label={selectedSupport.label} icon={<Anchor size={15} />} id={selectedSupport.id}><form className="property-form" onSubmit={saveSupportEdit}>
            <SelectField label="约束节点" value={supportNodeId} onChange={setSupportNodeId} options={project.nodes.map((node) => ({ value: node.id, label: node.label }))} />
            <RestraintFields restraints={supportRestraints} onChange={setSupportRestraints} /><FormFeedback error={formError} /><button className="button primary" type="submit">保存支座属性</button>
          </form></Inspector>}
          {selectedLoad && <Inspector title="节点集中荷载" label={selectedLoad.label} icon={<Plus size={15} />} id={selectedLoad.id}><form className="property-form" onSubmit={saveLoadEdit}>
            <SelectField label="加载节点" value={loadDraft.nodeId} onChange={(nodeId) => setLoadDraft({ ...loadDraft, nodeId })} options={project.nodes.map((node) => ({ value: node.id, label: node.label }))} />
            <LoadCaseField project={project} value={loadDraft.loadCaseId} onChange={(loadCaseId) => setLoadDraft({ ...loadDraft, loadCaseId })} />
            <LoadFields draft={loadDraft} onChange={setLoadDraft} /><FormFeedback error={formError} /><button className="button primary" type="submit">保存荷载属性</button>
          </form></Inspector>}
          {selectedUniform && <Inspector title="杆件均布荷载" label={selectedUniform.label} icon={<ArrowDownToLine size={15} />} id={selectedUniform.id}><section className="property-section"><h3>已应用荷载</h3><dl><div><dt>所属工况</dt><dd>{selectedUniform.loadCaseId}</dd></div><div><dt>作用范围</dt><dd>整根杆件</dd></div><div><dt>坐标系</dt><dd>{selectedUniform.coordinateSystem === "global" ? "全局 XYZ" : "杆件局部 xyz"}</dd></div><div><dt>q ({u.unit("kN/m")})</dt><dd>{u.vector(selectedUniform.intensity, "kN/m")}</dd></div></dl></section><form className="property-form" onSubmit={(event) => submitUniform(event, true)}><UniformFields project={project} draft={uniformDraft} onChange={setUniformDraft} /><FormFeedback error={formError} /><button className="button primary" type="submit">保存均布荷载属性</button><button className="button ghost" type="button" onClick={removeUniform}><Trash2 size={14} />删除均布荷载</button></form></Inspector>}
          {caseResult?.modal && !selection && <ModalResultPanel result={caseResult} current={resultIsCurrent(caseResult)} modeNumber={modeNumber} onModeChange={setModeNumber} scale={deformationScale} onScaleChange={setDeformationScale} onShowShape={() => setResultView("deformation")} />}
          {caseResult && !caseResult.modal && !selection && <AnalysisResultPanel result={caseResult} project={project} view={resultView} forceComponent={forceComponent} deformationScale={deformationScale} onViewChange={setResultView} onForceComponentChange={setForceComponent} onDeformationScaleChange={setDeformationScale} onOpenComparison={() => setComparisonOpen(true)} onSelect={(next, focus, preferredView) => { selectObject(next); setResultFocus(focus ?? null); if (focus) setResultView(preferredView ?? "deformation"); }} />}
          {!selection && !caseResult && <div className="inspector-empty"><strong>未选择对象</strong><p>{activeCase.id} · 尚无分析结果</p></div>}
        </BottomProperties>
      </section>

      <AiConversationPanel key={`${project.id}:${activeSessionRef.current}`} project={project} sessionId={activeSessionRef.current} selection={aiSelection} open={assistantPanelOpen} onClose={() => setAssistantPanelOpen(false)} onSettings={() => setSettingsDialogOpen(true)} onPreview={setAiPreview}
        onTaskStateChange={(state) => {
          const current = activeProjectRef.current;
          if (state.projectId !== current.id) return;
          const analyses = new Map(state.analyses.map((item) => [item.taskId, item]));
          for (const [taskId, input] of pendingAnalysisInputsRef.current) if (input.projectId === current.id && state.scheduled.some((task) => task.id === taskId && !["completed", "cancelled"].includes(task.status))) analyses.set(taskId, { taskId, input });
          const nextState = { ...state, analyses: [...analyses.values()] };
          if (sameInputValue(current.taskState, nextState)) return;
          const next = { ...current, taskState: nextState };
          activeProjectRef.current = next; setProject(next);
        }}
        onResumeAnalysis={(input) => runAnalysis(true, getAnalysisSourceId(input), input)}
        onPersistenceError={(message) => setStatus({ tone: "error", text: message })}
        onEditsConfirm={(confirmation) => {
          const current = activeProjectRef.current;
          const outcome = editConfirmationRef.current.confirm(current, confirmation);
          if (outcome.project !== current) {
            activateProject(outcome.project, false);
            setSelectedNodeIds(new Set()); setSelectedMemberIds(new Set()); setSelection(null); setFormError(null);
          }
          setStatus({ tone: outcome.result.status === "applied" ? "success" : "error", text: outcome.result.message });
          return outcome.result;
        }}
        onTaskConfirm={(confirmation) => {
          const current = activeProjectRef.current;
          const outcome = taskDraftConfirmationRef.current.confirm(current, confirmation);
          if (outcome.project !== current) {
            activateProject(outcome.project, false);
            setSelectedNodeIds(new Set()); setSelectedMemberIds(new Set()); setSelection(null); setFormError(null);
          }
          setStatus({ tone: outcome.result.status === "applied" ? "success" : "error", text: outcome.result.message });
          return outcome.result;
        }}
        comparison={comparisonPair} onComparison={(pair, open) => { setComparisonPair(pair); if (open) setComparisonOpen(true); }}
        onSectionConfirm={(confirmation) => {
          const current = activeProjectRef.current;
          const outcome = sectionConfirmationRef.current.confirm(current, confirmation.selection, confirmation);
          if (outcome.project !== current) activateProject(outcome.project, false);
          setStatus({ tone: outcome.result.status === "applied" ? "success" : "error", text: outcome.result.message });
          return outcome.result;
        }}
        onLocateTargets={(targets) => {
          const nodes = targets.filter((target) => target.kind === "node" && project.nodes.some((item) => item.id === target.id));
          const members = targets.filter((target) => target.kind === "member" && project.members.some((item) => item.id === target.id));
          setSelectedNodeIds(new Set(nodes.map((item) => item.id as NodeId)));
          setSelectedMemberIds(new Set(members.map((item) => item.id as MemberId)));
          const first = [...members, ...nodes][0];
          selectObject(first ? first as Selection : null);
          setPropertyPanelOpen(true); setDiagnosticFitRequest((value) => value + 1);
          if (nodes.length + members.length !== targets.length) setStatus({ tone: "neutral", text: "部分任务目标已删除，仅定位仍存在的对象" });
        }}
        analysis={caseResult} onLocateResult={(ref) => {
          const result = project.analysisResults.find((item) => item.id === ref.analysisId);
          if (!result || result.projectId !== project.id) { setStatus({ tone: "error", text: "引用分析已不可用，请重新读取当前结果" }); return; }
          setHistoryAnalysisId(undefined);
          if (ref.source.id !== (project.activeAnalysisCaseId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId) && [...project.analysisCases, ...project.loadCases, ...project.loadCombinations].some((source) => source.id === ref.source.id)) {
            const next = selectAnalysisSource(project, ref.source.id);
            activateProject(next, false, "restore");
          }
          setResultReference(ref); setPropertyPanelOpen(true);
          const exists = (ref.object.kind === "node" ? project.nodes : project.members).some((item) => item.id === ref.object.id);
          selectObject(exists ? { kind: ref.object.kind, id: ref.object.id } as Selection : null);
          setSelectedNodeIds(new Set()); setSelectedMemberIds(new Set());
          if (ref.object.kind === "member") {
            setResultView(ref.quantity === "sectionForces" ? "forces" : "model"); setForceComponent(ref.component as ForceComponent);
            const member = result.members.find((item) => item.memberId === ref.object.id)!;
            setResultFocus({ memberId: ref.object.id, position: ref.position ?? (ref.quantity === "endEndForces" ? member.length : 0) });
          } else { setResultView(ref.quantity === "displacement" ? "deformation" : "model"); setResultFocus(null); }
          setDiagnosticFitRequest((value) => value + 1);
        }}
        analysisBusy={analysisBusy} scheduler={analysisSchedulerRef.current} onAnalyze={(sourceId) => runAnalysis(true, sourceId)} onCancelAnalysis={cancelAnalysis}
        onConditionsConfirm={(confirmation) => {
          const current = activeProjectRef.current;
          const outcome = conditionsConfirmationRef.current.confirm(current, confirmation);
          // This reviewed source selection belongs to the same confirmed task and must keep its continuation.
          if (outcome.project !== current) activateProject(outcome.project, false, "record");
          setStatus({ tone: outcome.result.status === "applied" ? "success" : "error", text: outcome.result.message });
          return outcome.result;
        }}
        onConfirm={(confirmation) => {
          const current = activeProjectRef.current;
          const outcome = frameConfirmationRef.current.confirm(current, confirmation);
          if (outcome.project !== current) activateProject(outcome.project, false);
          setStatus({ tone: outcome.result.status === "applied" ? "success" : "error", text: outcome.result.message });
          return outcome.result;
        }} />
    </ResizableWorkspace>

    <footer className={`statusbar ${recoveryError ? "error" : status.tone}`} role="status"><span className="status-indicator" /><span>{status.text}</span>
      {(recoveryError || recoverySource) && <span className="recovery-notice" data-testid="recovery-notice" role={recoveryError ? "alert" : undefined} title={recoveryError ?? recoverySource!.id}>{recoveryError ?? `本机自动快照 ${recoveryTime(recoverySource!.createdAt)} · 尚未手动保存`}</span>}
      <span className="status-spacer" /><span>当前选择 {currentSelectionLabel}</span><span>{project.nodes.length} 节点</span><span>{project.members.length} 杆件</span><span>长度 {u.unit("m")}</span><span>全局坐标系 · Z 向上</span></footer>

    {nodeDialogOpen && <Dialog title="创建空间节点" copy={`输入全局坐标，当前长度单位 ${u.unit("m")}。`} onClose={() => { setNodeDialogOpen(false); setFormError(null); }}><form onSubmit={submitNode}><div className="coordinate-inputs">{(["x", "y", "z"] as const).map((axis) => <NumberField key={axis} label={`${axis.toUpperCase()} 坐标`} value={newNodeDraft[axis]} onChange={(value) => setNewNodeDraft({ ...newNodeDraft, [axis]: value })} unit="m" />)}</div><FormFeedback error={formError} /><DialogActions close={() => { setNodeDialogOpen(false); setFormError(null); }} submit="添加到模型" /></form></Dialog>}
    {resourceDialogOpen && <Dialog title="创建材料与截面" copy="可从已核对库条目载入，也可保留为自定义参数。所有值以项目文件实际保存的参数为准。" onClose={() => setResourceDialogOpen(false)}><form onSubmit={submitResources}><div className="resource-columns"><fieldset className="resource-fieldset"><legend>材料库</legend><SelectField label="库条目" value={materialCatalogId} onChange={(value) => { setMaterialCatalogId(value); const entry = getMaterialCatalogEntry(value); if (entry) setMaterialDraft({ name: entry.name, elasticModulusGPa: String(entry.elasticModulusGPa), poissonRatio: String(entry.poissonRatio), densityKgM3: String(entry.densityKgM3) }); }} options={[{ value: "", label: "自定义参数" }, ...MATERIAL_CATALOG.map((entry) => ({ value: entry.catalogId, label: entry.displayName }))]} />{materialCatalogId && <CatalogSourceView source={getMaterialCatalogEntry(materialCatalogId)?.source} />}</fieldset><fieldset className="resource-fieldset"><legend>截面库</legend><SelectField label="库条目" value={sectionCatalogId} onChange={(value) => { setSectionCatalogId(value); const entry = getSectionCatalogEntry(value); if (entry) setSectionDraft({ name: entry.name, areaM2: String(entry.areaM2), secondMomentYM4: String(entry.secondMomentYM4), secondMomentZM4: String(entry.secondMomentZM4), torsionalConstantM4: String(entry.torsionalConstantM4) }); }} options={[{ value: "", label: "自定义参数" }, ...SECTION_CATALOG.map((entry) => ({ value: entry.catalogId, label: entry.displayName }))]} />{sectionCatalogId && <><CatalogSourceView source={getSectionCatalogEntry(sectionCatalogId)?.source} /><SectionFieldNotes /></>}</fieldset></div><div className="resource-columns"><MaterialFields draft={materialDraft} setDraft={(value) => { setMaterialCatalogId(""); setMaterialDraft(value); }} /><SectionFields draft={sectionDraft} setDraft={(value) => { setSectionCatalogId(""); setSectionDraft(value); }} /></div><FormFeedback error={formError} /><DialogActions close={() => setResourceDialogOpen(false)} submit="保存材料与截面" /></form></Dialog>}
    {memberDialogOpen && <Dialog title="连接空间杆件" copy="选择两个不同位置的节点，并指定材料、截面和绕局部 x 轴的截面转角。" onClose={() => { setMemberDialogOpen(false); setFormError(null); }}><form onSubmit={submitMember}><div className="form-grid"><SelectField label="起点节点" value={newMemberDraft.startNodeId} onChange={(value) => setNewMemberDraft({ ...newMemberDraft, startNodeId: value })} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><SelectField label="终点节点" value={newMemberDraft.endNodeId} onChange={(value) => setNewMemberDraft({ ...newMemberDraft, endNodeId: value })} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><SelectField label="材料" value={newMemberDraft.materialId} onChange={(value) => setNewMemberDraft({ ...newMemberDraft, materialId: value })} options={project.materials.map((item) => ({ value: item.id, label: `${item.label} · ${item.name}` }))} /><SelectField label="截面" value={newMemberDraft.sectionId} onChange={(value) => setNewMemberDraft({ ...newMemberDraft, sectionId: value })} options={project.sections.map((item) => ({ value: item.id, label: `${item.label} · ${item.name}` }))} /><NumberField label="截面转角（°）" value={newMemberDraft.rotationDegrees} onChange={(value) => setNewMemberDraft({ ...newMemberDraft, rotationDegrees: value })} unit="°" /><MemberReleaseFields value={newMemberDraft.endReleases} onChange={(endReleases) => setNewMemberDraft({ ...newMemberDraft, endReleases })} /></div><FormFeedback error={formError} /><DialogActions close={() => { setMemberDialogOpen(false); setFormError(null); }} submit="添加杆件" /></form></Dialog>}
    {batchDialog && <Dialog title={batchDialog === "node" ? "批量移动节点" : "批量修改杆件"} copy={batchDialog === "node" ? `将一次移动 ${selectedNodeIds.size} 个节点，任一校验失败则全部不提交。` : `将一次设置 ${selectedMemberIds.size} 个杆件的截面转角，任一校验失败则全部不提交。`} onClose={() => { setBatchDialog(null); setFormError(null); }}><form onSubmit={submitBatchEdit}>{batchDialog === "node" ? <div className="coordinate-inputs"><NumberField label="X 偏移" value={batchDraft.x} onChange={(value) => setBatchDraft({ ...batchDraft, x: value })} unit="m" /><NumberField label="Y 偏移" value={batchDraft.y} onChange={(value) => setBatchDraft({ ...batchDraft, y: value })} unit="m" /><NumberField label="Z 偏移" value={batchDraft.z} onChange={(value) => setBatchDraft({ ...batchDraft, z: value })} unit="m" /></div> : <NumberField label="统一截面转角" value={batchDraft.rotationDegrees} onChange={(value) => setBatchDraft({ ...batchDraft, rotationDegrees: value })} unit="°" />}<FormFeedback error={formError} /><DialogActions close={() => { setBatchDialog(null); setFormError(null); }} submit="应用批量修改" /></form></Dialog>}
    {supportDialogOpen && <Dialog title="创建节点支座" copy="支座独立约束节点的六个自由度。固定支座默认约束平移与转动全部分量。" onClose={() => { setSupportDialogOpen(false); selectObject(selection); }}><form onSubmit={submitSupport}><SelectField label="约束节点" value={supportNodeId} onChange={setSupportNodeId} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><RestraintFields restraints={supportRestraints} onChange={setSupportRestraints} /><FormFeedback error={formError} /><DialogActions close={() => { setSupportDialogOpen(false); selectObject(selection); }} submit="添加支座" /></form></Dialog>}
    {loadDialogOpen && <Dialog title="创建节点集中荷载" copy="全局 XYZ · 力 kN · 力矩 kN·m" onClose={() => { setLoadDialogOpen(false); selectObject(selection); }}><form onSubmit={submitLoad}><SelectField label="加载节点" value={loadDraft.nodeId} onChange={(value) => setLoadDraft({ ...loadDraft, nodeId: value })} options={project.nodes.map((item) => ({ value: item.id, label: `${item.label} · ${item.id}` }))} /><LoadCaseField project={project} value={loadDraft.loadCaseId} onChange={(loadCaseId) => setLoadDraft({ ...loadDraft, loadCaseId })} /><div className="load-columns"><LoadFields draft={loadDraft} onChange={setLoadDraft} /></div><FormFeedback error={formError} /><DialogActions close={() => { setLoadDialogOpen(false); selectObject(selection); }} submit="添加节点荷载" /></form></Dialog>}
    {uniformDialogOpen && <Dialog title="创建杆件均布荷载" copy={`整根杆件 · ${uniformDraft.loadCaseId} · ${u.unit("kN/m")}`} onClose={() => { setUniformDialogOpen(false); selectObject(selection); }}><form onSubmit={(event) => submitUniform(event, false)}><UniformFields project={project} draft={uniformDraft} onChange={setUniformDraft} /><FormFeedback error={formError} /><DialogActions close={() => { setUniformDialogOpen(false); selectObject(selection); }} submit="添加均布荷载" /></form></Dialog>}
    {selfWeightDialogOpen && <Dialog title="设置结构自重" copy={`材料密度 ρ (${u.unit("kg/m³")}) · 截面面积 A (${u.unit("m²")}) · 重力加速度 g (${u.unit("m/s²")}) · ${selfWeightDraft.loadCaseId}`} onClose={() => { setSelfWeightDialogOpen(false); setFormError(null); }}><form onSubmit={submitSelfWeight}><label className="check-field self-weight-toggle"><input type="checkbox" checked={selfWeightDraft.enabled} onChange={(event) => setSelfWeightDraft({ ...selfWeightDraft, enabled: event.target.checked })} /><span>启用结构自重</span></label><LoadCaseField project={project} value={selfWeightDraft.loadCaseId} onChange={(loadCaseId) => setSelfWeightDraft({ ...selfWeightDraft, loadCaseId, enabled: project.selfWeight.enabled && project.selfWeight.loadCaseId === loadCaseId })} /><div className="coordinate-inputs"><NumberField label="重力 X" value={selfWeightDraft.gx} unit="m/s²" onChange={(value) => setSelfWeightDraft({ ...selfWeightDraft, gx: value })} /><NumberField label="重力 Y" value={selfWeightDraft.gy} unit="m/s²" onChange={(value) => setSelfWeightDraft({ ...selfWeightDraft, gy: value })} /><NumberField label="重力 Z" value={selfWeightDraft.gz} unit="m/s²" onChange={(value) => setSelfWeightDraft({ ...selfWeightDraft, gz: value })} /></div><SelfWeightReferences project={project} /><FormFeedback error={formError} /><DialogActions close={() => { setSelfWeightDialogOpen(false); setFormError(null); }} submit="保存自重设置" /></form></Dialog>}
    {topologyOpen && <TopologyEditor key={project.id} project={project} selectedMemberIds={selectedMemberIds} onClose={() => setTopologyOpen(false)} onCommit={(next) => { activateProject(next, false); selectObject(null); setStatus({ tone: "success", text: "拓扑变更已应用，可整组撤销；相关任务请重读替换身份" }); }} />}
    {sectionEditor && <ParametricSectionEditor key={project.id + (sectionEditor.id ?? "new")} project={project} initialSectionId={sectionEditor.id} initialInput={sectionEditor.input} onClose={() => setSectionEditor(null)} onCommit={(next) => { activateProject(next, false); selectObject(selection, next); setStatus({ tone: "success", text: "截面变更已成组应用，可撤销；相关结果需重算" }); }} />}
    {nodeMergeOpen && <NodeMergeEditor key={project.id} project={project} onClose={() => setNodeMergeOpen(false)} onCommit={(next) => { activateProject(next, false); selectObject(null); setStatus({ tone: "success", text: "节点合并已成组应用，可撤销；相关任务需重读目标身份" }); }} />}
    {settingsDialogOpen && <Dialog id="settings-dialog" title="设置" copy="FrameMind" onClose={() => setSettingsDialogOpen(false)}><section className="settings-general" aria-label="常规设置"><h3>外观</h3><div className="theme-options" role="group" aria-label="主题">{(["dark", "light"] as const).map((value) => <button key={value} className="button ghost" aria-pressed={theme === value} onClick={() => setTheme(value)}>{value === "dark" ? <Moon size={15} /> : <Sun size={15} />}{value === "dark" ? "深色" : "浅色"}</button>)}</div></section><DeepSeekSettingsPanel /></Dialog>}
    {analysisCaseManagerOpen && <AnalysisCaseManager project={project} onChange={(next) => { activateProject(next, false); setHistoryAnalysisId(undefined); setSelection(null); }} onAnalyze={(id) => { setAnalysisCaseManagerOpen(false); void runAnalysis(true, id); }} onViewHistory={(id) => { setHistoryAnalysisId(id); setResultReference(null); setPropertyPanelOpen(true); setAnalysisCaseManagerOpen(false); }} onLoads={() => { setAnalysisCaseManagerOpen(false); setLoadCaseManagerOpen(true); }} onCombinations={() => { setAnalysisCaseManagerOpen(false); setLoadCombinationManagerOpen(true); }} onClose={() => setAnalysisCaseManagerOpen(false)} />}
    {loadCaseManagerOpen && <LoadCaseManager project={project} onChange={(next) => { activateProject(next, false); setSelection(null); setFormError(null); }} onSelfWeight={(loadCaseId) => { setLoadCaseManagerOpen(false); openSelfWeightDialog(loadCaseId); }} onClose={() => setLoadCaseManagerOpen(false)} />}
    {loadCombinationManagerOpen && <LoadCombinationManager project={project} onChange={(next) => { activateProject(next, false); setSelection(null); setFormError(null); }} onClose={() => setLoadCombinationManagerOpen(false)} />}
    {comparisonOpen && <AnalysisComparisonDialog key={`${comparisonPair?.beforeId ?? ""}:${comparisonPair?.afterId ?? ""}`} project={project} pair={comparisonPair} onPairChange={setComparisonPair} onClose={() => setComparisonOpen(false)} onLocate={(kind, id) => { setComparisonOpen(false); selectObject({ kind, id } as Selection); setDiagnosticFitRequest((value) => value + 1); }} />}
    {reportOpen && <EngineeringReportDialog key={project.id} project={project} initialAnalysisId={caseResult?.id} onClose={() => setReportOpen(false)} onStatus={(tone, text) => setStatus({ tone, text })} />}
  </main></UnitPresetContext.Provider>;
}

function AnalysisResultPanel({ result, project, view, forceComponent, deformationScale, onViewChange, onForceComponentChange, onDeformationScaleChange, onOpenComparison, onSelect }: {
  result: AnalysisResult;
  project: FrameProject;
  view: ResultViewMode;
  forceComponent: ForceComponent;
  deformationScale: number;
  onViewChange(value: ResultViewMode): void;
  onForceComponentChange(value: ForceComponent): void;
  onDeformationScaleChange(value: number): void;
  onOpenComparison(): void;
  onSelect(next: Selection, focus?: { memberId: string; position: number }, preferredView?: ResultViewMode): void;
}) {
  const u = useUnits();
  const stale = useMemo(() => !isAnalysisResultCurrent(project, result), [project, result]);
  const selfWeight = useMemo(() => getSelfWeightSummary(result.input), [result]);
  const combination = result.input.combination;
  const forceLabels: Record<ForceComponent, string> = { N: "轴力 N", Vy: "剪力 Vy", Vz: "剪力 Vz", T: "扭矩 T", My: "弯矩 My", Mz: "弯矩 Mz" };
  const forceUnits: Record<ForceComponent, string> = { N: "kN", Vy: "kN", Vz: "kN", T: "kN·m", My: "kN·m", Mz: "kN·m" };
  const forceIndex: Record<ForceComponent, number> = { N: 0, Vy: 1, Vz: 2, T: 3, My: 4, Mz: 5 };
  const maxForceRecord = useMemo(() => view === "forces" ? result.members.reduce<{ value: number; memberId: string; position: number } | null>((best, member) => {
    try {
      for (const sample of getMemberResponseSamples(result, member.memberId, 17)) {
        const value = Math.abs(sample.forces[forceIndex[forceComponent]]);
        if (!best || value > best.value) best = { value, memberId: member.memberId, position: sample.position };
      }
    } catch { /* incompatible historic results remain visible in the table */ }
    return best;
  }, null) : null, [view, result, forceComponent]);
  const maxForce = maxForceRecord?.value ?? 0;
  const formatEndForces = (values: number[]) => values.map((value, index) => `${["Fx", "Fy", "Fz", "Mx", "My", "Mz"][index]} ${u.quantity(value, index < 3 ? "kN" : "kN·m")}`).join(" · ");
  const localSectionText = (values: number[]) => values.map((value, index) => `${["N", "Vy", "Vz", "T", "My", "Mz"][index]} ${u.quantity(value, index < 3 ? "kN" : "kN·m")}`).join(" · ");

  return <div className="analysis-result-panel">
    <div className="selection-title"><span className="selection-icon"><Calculator size={15} /></span><div><small>所选分析</small><strong>3D 线弹性静力</strong></div></div>
    <section className="property-section"><div className="result-section-heading"><h3>计算输入</h3><button type="button" className="button ghost compact-button" onClick={onOpenComparison} disabled={project.analysisResults.length < 2} title={project.analysisResults.length < 2 ? "至少需要两份已完成分析" : "选择两份已完成分析"}><Files size={14} />前后结果对比</button></div><dl>
      {result.input.analysisCase && <div><dt>分析工况 / 方法</dt><dd>{result.input.analysisCase.id} · {result.input.analysisCase.name} · 线性静力</dd></div>}
      <div><dt>{combination ? "用户定义组合" : "来源工况"}</dt><dd>{combination ? `${combination.definition.id} · ${combination.definition.name}` : result.input.loadCase ? `${result.input.loadCase.id} · ${result.input.loadCase.name}` : "LC1 · 旧版输入"}</dd></div>
      <div><dt>模型版本</dt><dd>R{result.projectRevision}{stale ? " · 已过期" : " · 当前"}</dd></div>
      <div><dt>支座 / 荷载</dt><dd>{result.input.supports.length} / {result.input.nodalLoads.length + (result.input.uniformLoads?.length ?? 0)}</dd></div>
      <div><dt>{combination ? "加权自重" : "自重"}</dt><dd>{selfWeight.enabled ? `${u.quantity(selfWeight.totalWeightKN, "kN")}${combination ? "" : ` · ${selfWeight.loadCaseId}`}` : "未启用"}</dd></div>
      <div><dt>历史结果</dt><dd>{project.analysisResults.length} 份 · 本结果 {result.id.slice(-8)}</dd></div>
    </dl><details><summary>求解与输入详情</summary><dl><div><dt>理论</dt><dd>Euler-Bernoulli 空间刚架</dd></div><div><dt>求解版本</dt><dd>{result.input.solver?.implementation ?? "T03（未记录）"}</dd></div></dl></details></section>
    {combination && <section className="property-section"><h3>组合依据 · 无量纲系数</h3><ul className="combination-source-terms">{combination.definition.terms.map((term) => <li key={term.loadCaseId}>{term.loadCaseId} · {combination.cases.find((item) => item.loadCase.id === term.loadCaseId)?.loadCase.name} × {term.factor}</li>)}</ul><p className="combination-basis">用户定义 · 线弹性 · {u.unit("m")} / {u.unit("kN")} / {u.unit("kN·m")}</p></section>}
    <AnalysisProcess result={result} resultIsCurrent={!stale} />
    <section className="property-section result-view-controls" aria-label="结果视图">
      <h3>结果视图</h3>
      <div className="result-view-tabs" role="tablist">
        <button className={view === "model" ? "active" : ""} role="tab" aria-selected={view === "model"} onClick={() => onViewChange("model")}>结果表</button>
        <button className={view === "deformation" ? "active" : ""} role="tab" aria-selected={view === "deformation"} onClick={() => onViewChange("deformation")}>变形图</button>
        <button className={view === "forces" ? "active" : ""} role="tab" aria-selected={view === "forces"} onClick={() => onViewChange("forces")}>内力图</button>
      </div>
      {view === "deformation" && <label className="result-scale-field"><span>变形放大比例</span><input aria-label="变形放大比例" type="range" min="1" max="1000" step="1" value={deformationScale} onChange={(event) => onDeformationScaleChange(Number(event.target.value))} /><output>{deformationScale}×</output></label>}
      {view === "forces" && <><label className="result-component-field"><span>内力分量</span><select aria-label="内力分量" value={forceComponent} onChange={(event) => onForceComponentChange(event.target.value as ForceComponent)}>{(Object.keys(forceLabels) as ForceComponent[]).map((item) => <option key={item} value={item}>{forceLabels[item]}</option>)}</select></label><div className="result-legend"><span className="legend-line" />{forceLabels[forceComponent]} · {u.unit(forceUnits[forceComponent])}<small>当前极值 {u.quantity(maxForce, forceUnits[forceComponent])}</small>{maxForceRecord && <button type="button" className="query-locate-button" onClick={() => onSelect({ kind: "member", id: maxForceRecord.memberId as MemberId }, { memberId: maxForceRecord.memberId, position: maxForceRecord.position }, "forces")}>定位极值</button>}</div></>}
      {view !== "model" && <p className="result-view-note">图形、表格和图例均来自 {combination ? `${combination.definition.id} · ${combination.definition.name}` : result.input.loadCase?.id ?? "当前工况"} 的冻结分析结果；点击杆件结果可定位对象。</p>}
    </section>
    {view === "model" && <>
      <section className="property-section"><h3>节点结果 · 位移、转动与支座反力</h3><PagedItems items={result.nodes} label="节点结果">{(nodes) => <div className="analysis-table">{nodes.map((node) => { const sourceNode = result.input.nodes.find((item) => item.id === node.nodeId); return <div className="analysis-row result-select-row" key={node.nodeId} role="button" tabIndex={0} onClick={() => sourceNode && onSelect({ kind: "node", id: sourceNode.id })} onKeyDown={(event) => { if (event.key === "Enter") sourceNode && onSelect({ kind: "node", id: sourceNode.id }); }}>
        <strong>{sourceNode?.label ?? node.nodeId}</strong>{indeterminateRotationComponents(result, node.nodeId).length > 0 && <span>转角 {indeterminateRotationComponents(result, node.nodeId).join(" / ")} 含脱开方向，仅显示坐标参考值；梁端转角见杆件恢复。</span>}
        <span title={`${u.vector(node.displacement, "m", 10)}`}>位移 {u.vector(node.displacement, "m")}</span><span title={`${u.vector(node.rotation, "rad", 10)}`}>转角 {u.vector(node.rotation, "rad")}</span><span title={`${u.vector(node.reaction, "kN", 10)}`}>反力 {u.vector(node.reaction, "kN")}</span><span title={`${u.vector(node.reactionMoment, "kN·m", 10)}`}>反力矩 {u.vector(node.reactionMoment, "kN·m")}</span>
      </div>; })}</div>}</PagedItems></section>
      <section className="property-section"><h3>杆端内力（局部轴）</h3><PagedItems items={result.members} label="杆端内力">{(members) => <div className="analysis-table">{members.map((member) => { const sourceMember = result.input.members.find((item) => item.id === member.memberId); return <div className="analysis-row result-select-row" key={member.memberId} role="button" tabIndex={0} onClick={() => sourceMember && onSelect({ kind: "member", id: sourceMember.id }, { memberId: sourceMember.id, position: 0 })} onKeyDown={(event) => { if (event.key === "Enter") sourceMember && onSelect({ kind: "member", id: sourceMember.id }, { memberId: sourceMember.id, position: 0 }); }}>
        <strong>{sourceMember?.label ?? member.memberId} · L {u.quantity(member.length, "m")}</strong><span>局部轴分量顺序 N · Vy · Vz · T · My · Mz</span><span>起点 {formatEndForces(member.localEndForces.start)}</span><span>终点 {formatEndForces(member.localEndForces.end)}</span>{(() => { try { const start = getMemberSectionForces(result, member.memberId, 0).forces; const end = getMemberSectionForces(result, member.memberId, member.length).forces; return <><span>起点截面 {localSectionText(start)}</span><span>终点截面 {localSectionText(end)}</span></>; } catch { return null; } })()}<MemberSectionQuery key={result.id} result={result} member={member} onLocate={(position) => sourceMember && onSelect({ kind: "member", id: sourceMember.id }, { memberId: sourceMember.id, position })} />
      </div>; })}</div>}</PagedItems></section>
    </>}
  </div>;
}

function analysisSourceLabel(result: AnalysisResult): string {
  if (result.input.analysisCase) return `${result.input.analysisCase.id} · ${result.input.analysisCase.name}（${result.modal ? "模态" : "线性静力"} · ${result.input.analysisCase.loadSourceId}）`;
  if (result.input.combination) return `${result.input.combination.definition.id} · ${result.input.combination.definition.name}（组合）`;
  return result.input.loadCase ? `${result.input.loadCase.id} · ${result.input.loadCase.name}` : "LC1 · 旧版输入";
}

function AnalysisComparisonDialog({ project, pair, onPairChange, onClose, onLocate }: { project: FrameProject; pair?: AnalysisPairIds; onPairChange(pair: AnalysisPairIds): void; onClose(): void; onLocate(kind: "node" | "member", id: string): void }) {
  const u = useUnits();
  const comparisonVector = (value: { x: number; y: number; z: number }, unit: string) => u.vector(value, unit);
  const comparisonForce = (values: AnalysisForceVector) => values.map((value, index) => `${ANALYSIS_FORCE_COMPONENTS[index].label} ${u.quantity(value, ANALYSIS_FORCE_COMPONENTS[index].unit)}`).join(" · ");
  const results = project.analysisResults;
  const latest = project.latestAnalysis ?? results.at(-1);
  const defaultAfter = latest?.id ?? results.at(-1)?.id ?? "";
  const defaultBefore = results.slice(0, Math.max(0, results.findIndex((item) => item.id === defaultAfter))).filter((item) => latest && item.input.loadCase?.id === latest.input.loadCase?.id && item.input.combination?.definition.id === latest.input.combination?.definition.id).at(-1)?.id ?? results.find((item) => item.id !== defaultAfter)?.id ?? "";
  const [beforeId, setBeforeId] = useState(pair?.beforeId ?? defaultBefore);
  const [afterId, setAfterId] = useState(pair?.afterId ?? defaultAfter);
  useEffect(() => { if (beforeId && afterId && (pair?.beforeId !== beforeId || pair?.afterId !== afterId)) onPairChange({ beforeId, afterId }); }, [beforeId, afterId, pair, onPairChange]);
  const before = results.find((item) => item.id === beforeId);
  const after = results.find((item) => item.id === afterId);
  const comparison: AnalysisComparison | null = before && after && before.id !== after.id ? compareAnalysisResults(before, after) : null;
  const changeLabels: Record<string, string> = { node: "节点", member: "杆件", material: "材料", section: "截面", support: "支座", load: "节点荷载", "uniform-load": "均布荷载", "self-weight": "结构自重" };
  return <Dialog title="前后结果对比" copy="选择两份已完成分析。所有数值来自各自冻结输入；来源、单位或对象无法匹配时不会强行比较。" onClose={onClose}>
    <div className="comparison-pickers"><SelectField label="前一份结果" value={beforeId} onChange={setBeforeId} options={results.map((item) => ({ value: item.id, label: `R${item.projectRevision} · ${analysisSourceLabel(item)} · ${item.id.slice(-8)}` }))} /><SelectField label="后一份结果" value={afterId} onChange={setAfterId} options={results.map((item) => ({ value: item.id, label: `R${item.projectRevision} · ${analysisSourceLabel(item)} · ${item.id.slice(-8)}` }))} /></div>
    {before && after && <section className="comparison-source-grid"><div><strong>前一份</strong><span>{analysisSourceLabel(before)}</span><small>分析 ID {before.id} · 模型版本 R{before.projectRevision} · {new Date(before.createdAt).toLocaleString()}</small></div><div><strong>后一份</strong><span>{analysisSourceLabel(after)}</span><small>分析 ID {after.id} · 模型版本 R{after.projectRevision} · {new Date(after.createdAt).toLocaleString()}</small></div></section>}
    {!before || !after ? <p className="comparison-empty">请选择两份不同的已完成分析。</p> : before.id === after.id ? <p className="comparison-empty">前后结果必须是两份不同的分析。</p> : comparison && !comparison.compatible ? <section className="comparison-incompatible" role="alert"><strong>无法比较</strong><ul>{comparison.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section> : comparison && <>
      <section className="comparison-section"><h3>模型变化 · {comparison.changes.length} 项</h3>{comparison.changes.length === 0 ? <p className="comparison-empty">两份分析的模型参数没有变化。</p> : <div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>对象</th><th>稳定 ID</th><th>变化参数</th></tr></thead><tbody>{comparison.changes.map((change) => <tr key={`${change.kind}-${change.id}`}><td>{changeLabels[change.kind] ?? change.kind} · {change.label}</td><td>{change.id}</td><td>{change.changes.join("、")}</td></tr>)}</tbody></table></div>}</section>
      <section className="comparison-section"><h3>节点响应变化 · 位移 / 支座反力</h3><div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>节点</th><th>位移（后一份 - 前一份）</th><th>反力（后一份 - 前一份）</th><th>定位</th></tr></thead><tbody>{comparison.nodes.map((row) => <tr key={row.id}><td>{row.label}<small>{row.id}</small></td><td>{comparisonVector(row.displacementDelta, "m")}</td><td>{comparisonVector(row.reactionDelta, "kN")}</td><td><button type="button" className="query-locate-button" onClick={() => onLocate("node", row.id)}>定位</button></td></tr>)}</tbody></table></div></section>
      <section className="comparison-section"><h3>杆件内力变化 · 局部轴</h3><div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>杆件</th><th>起点 ΔN / ΔVy / ΔVz / ΔT / ΔMy / ΔMz</th><th>终点 ΔN / ΔVy / ΔVz / ΔT / ΔMy / ΔMz</th><th>定位</th></tr></thead><tbody>{comparison.members.map((row) => <tr key={row.id}><td>{row.label}<small>{row.id}</small></td><td>{comparisonForce(row.startDelta)}</td><td>{comparisonForce(row.endDelta)}</td><td><button type="button" className="query-locate-button" onClick={() => onLocate("member", row.id)}>定位</button></td></tr>)}</tbody></table></div></section>
    </>}
    <div className="dialog-actions"><button type="button" className="button primary" onClick={onClose}>完成</button></div>
  </Dialog>;
}

function TreeGroup({ label, count, icon, children }: { label: string; count: number; icon: React.ReactNode; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  return <div className="tree-group"><button className="tree-group-label" aria-label={label} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}><ChevronDown className="group-chevron" size={13} />{icon}<span>{label}</span><em>{count}</em></button><div id={id} className="tree-items" hidden={!expanded}>{children}</div></div>;
}
function MenuAction({ icon, label, shortcut, onSelect }: { icon: React.ReactNode; label: string; shortcut: string; onSelect(): void }) { return <button className="menu-item" role="menuitem" onClick={onSelect}><span>{icon}{label}</span><kbd>{shortcut}</kbd></button>; }
function RestraintFields({ restraints, onChange }: { restraints: DofRestraints; onChange: (value: DofRestraints) => void }) {
  return <fieldset className="resource-fieldset"><legend>约束自由度</legend><div className="restraint-grid">{["UX 平移", "UY 平移", "UZ 平移", "RX 转动", "RY 转动", "RZ 转动"].map((label, index) => <label className="check-field" key={label}><input type="checkbox" checked={restraints[index]} onChange={(event) => onChange(restraints.map((value, itemIndex) => itemIndex === index ? event.target.checked : value) as DofRestraints)} /><span>{label}</span></label>)}</div></fieldset>;
}

function LoadCaseField({ project, value, onChange }: { project: FrameProject; value: string; onChange(value: string): void }) {
  return <SelectField label="所属工况" value={value} onChange={onChange} options={project.loadCases.map((item) => ({ value: item.id, label: `${item.id} · ${item.name}` }))} />;
}
function UniformFields({ project, draft, onChange }: { project: FrameProject; draft: UniformDraft; onChange(value: UniformDraft): void }) {
  return <><SelectField label="加载杆件" value={draft.memberId} onChange={(memberId) => onChange({ ...draft, memberId })} options={project.members.map((member) => ({ value: member.id, label: member.label }))} /><SelectField label="方向坐标系" value={draft.coordinateSystem} onChange={(coordinateSystem) => onChange({ ...draft, coordinateSystem: coordinateSystem as UniformDraft["coordinateSystem"] })} options={[{ value: "global", label: "全局 XYZ" }, { value: "local", label: "杆件局部 xyz" }]} /><LoadCaseField project={project} value={draft.loadCaseId} onChange={(loadCaseId) => onChange({ ...draft, loadCaseId })} />{(["qx", "qy", "qz"] as const).map((field) => <NumberField key={field} label={field} value={draft[field]} unit="kN/m" onChange={(value) => onChange({ ...draft, [field]: value })} />)}</>;
}

function SelfWeightReferences({ project }: { project: FrameProject }) {
  const u = useUnits();
  const materialIds = new Set(project.members.map((member) => member.materialId));
  const sectionIds = new Set(project.members.map((member) => member.sectionId));
  return <section className="property-section"><h3>参与自重的参数</h3><dl>{project.materials.filter((material) => materialIds.has(material.id)).map((material) => <div key={material.id}><dt>{material.label} · 密度 ρ</dt><dd>{u.quantity(material.densityKgM3, "kg/m³")}</dd></div>)}{project.sections.filter((section) => sectionIds.has(section.id)).map((section) => <div key={section.id}><dt>{section.label} · 面积 A</dt><dd>{u.quantity(section.areaM2, "m²")}</dd></div>)}{project.members.length === 0 && <div><dt>材料 / 截面</dt><dd>暂无杆件引用</dd></div>}</dl></section>;
}

function LoadFields({ draft, onChange }: { draft: LoadDraft; onChange: (value: LoadDraft) => void }) {
  const u = useUnits();
  return <>{([{ title: "节点力（kN）", unit: "kN", fields: ["fx", "fy", "fz"] }, { title: "节点力矩（kN·m）", unit: "kN·m", fields: ["mx", "my", "mz"] }] as const).map((group) => <fieldset className="resource-fieldset" key={group.title}><legend>{group.title.replace(group.unit, u.unit(group.unit))}</legend>{group.fields.map((field) => <NumberField key={field} label={field.toUpperCase()} value={draft[field]} unit={group.unit} onChange={(value) => onChange({ ...draft, [field]: value })} />)}</fieldset>)}</>;
}

function Inspector({ title, label, id, icon, children }: { title: string; label: string; id: string; icon: React.ReactNode; children: React.ReactNode }) { return <div className="inspector-content"><div className="inspector-overview"><div className="selection-title"><span className="selection-icon">{icon}</span><div><small>{title}</small><strong>{label}</strong></div></div><Identity id={id} label={label} /><p className="inspector-note">属性来自当前已应用模型，三维视图与项目文件共享同一对象身份。</p></div>{children}</div>; }
function Identity({ id, label }: { id: string; label: string }) { return <section className="property-section"><h3>标识</h3><dl><div><dt>稳定 ID</dt><dd>{id}</dd></div><div><dt>显示编号</dt><dd>{label}</dd></div></dl></section>; }
function CatalogSourceView({ source }: { source?: CatalogSource }) { return source ? <div className="catalog-source"><strong>{source.title}</strong><span>{source.publisher} · {source.edition}</span><span>单位：{source.units}</span><a href={source.url} target="_blank" rel="noreferrer">查看来源 · 核对于 {source.accessedOn}</a></div> : null; }
function SectionFieldNotes() { const u = useUnits(); return <div className="catalog-field-notes"><strong>截面字段含义</strong><span>A：截面面积（{u.unit("m²")}）</span><span>Iy：关于局部 y 轴的二次面积矩（{u.unit("m⁴")}）</span><span>Iz：关于局部 z 轴的二次面积矩（{u.unit("m⁴")}）</span><span>J：Saint-Venant 扭转常数（{u.unit("m⁴")}）</span></div>; }
function ResourceProvenanceView({ provenance }: { provenance: ResourceProvenance }) { return <section className="property-section"><h3>参数来源</h3>{provenance.kind === "catalog" ? <><dl><div><dt>来源类型</dt><dd>已核对库条目</dd></div><div><dt>库编号</dt><dd>{provenance.catalogId}</dd></div></dl><CatalogSourceView source={provenance.source} /></> : <><dl><div><dt>来源类型</dt><dd>自定义参数{provenance.derivedFrom ? "（由库条目修改）" : ""}</dd></div>{provenance.derivedFrom && <div><dt>原库编号</dt><dd>{provenance.derivedFrom.catalogId}</dd></div>}</dl>{provenance.derivedFrom && <CatalogSourceView source={provenance.derivedFrom.source} />}</>}</section>; }
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange(value: string): void; options: Array<{ value: string; label: string }> }) { return <label className="field"><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function FormFeedback({ error }: { error: string | null }) { return error ? <p className="form-error" role="alert">{error}</p> : null; }
function MaterialFields({ draft, setDraft }: { draft: MaterialDraft; setDraft(value: MaterialDraft): void }) { return <fieldset className="resource-fieldset"><legend>材料参数</legend><label className="field"><span>材料名称</span><input aria-label="材料名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><NumberField label="弹性模量 E" value={draft.elasticModulusGPa} unit="GPa" onChange={(value) => setDraft({ ...draft, elasticModulusGPa: value })} /><NumberField label="泊松比 ν" value={draft.poissonRatio} unit="无" onChange={(value) => setDraft({ ...draft, poissonRatio: value })} /><NumberField label="密度 ρ" value={draft.densityKgM3} unit="kg/m³" onChange={(value) => setDraft({ ...draft, densityKgM3: value })} /></fieldset>; }
function SectionFields({ draft, setDraft }: { draft: SectionDraft; setDraft(value: SectionDraft): void }) { return <fieldset className="resource-fieldset"><legend>截面参数</legend><label className="field"><span>截面名称</span><input aria-label="截面名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><NumberField label="面积 A" value={draft.areaM2} unit="m²" onChange={(value) => setDraft({ ...draft, areaM2: value })} /><NumberField label="惯性矩 Iy" value={draft.secondMomentYM4} unit="m⁴" onChange={(value) => setDraft({ ...draft, secondMomentYM4: value })} /><NumberField label="惯性矩 Iz" value={draft.secondMomentZM4} unit="m⁴" onChange={(value) => setDraft({ ...draft, secondMomentZM4: value })} /><NumberField label="扭转常数 J" value={draft.torsionalConstantM4} unit="m⁴" onChange={(value) => setDraft({ ...draft, torsionalConstantM4: value })} /></fieldset>; }
function NumberField({ label, value, unit, onChange }: { label: string; value: string; unit: string; onChange(value: string): void }) { const u = useUnits(); return <label className="field"><span>{label}</span><div><UnitInput aria-label={label} value={value} unit={unit} onValueChange={onChange} /><em>{u.unit(unit)}</em></div></label>; }
function Dialog({ id, title, copy, onClose, children }: { id?: string; title: string; copy: string; onClose(): void; children: React.ReactNode }) { return <div className="dialog-backdrop" onMouseDown={onClose}><section id={id} className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={15} /></button></header><p className="dialog-copy">{copy}</p><div className="dialog-form">{children}</div></section></div>; }
function DialogActions({ close, submit }: { close(): void; submit: string }) { return <div className="dialog-actions"><button type="button" className="button ghost" onClick={close}>取消</button><button type="submit" className="button primary">{submit}</button></div>; }
