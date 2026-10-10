export type CadVector = [number, number, number];
export interface CadBounds { min: number[]; max: number[] }
export interface CadCenterline {
  id: string; instanceId: number | null; solidId: number; sourceEntityIds: number[];
  start: number[]; end: number[]; direction: number[]; lengthM: number;
  endSections: number[][][]; boundingBox: CadBounds; method: string;
}
export interface CadEngineeringGeometry {
  schemaVersion: 1;
  recognitionToleranceM: number;
  definitions: Array<{ solidId: number; status: string; reason?: string; rejections?: string[]; sourceEntityIds: number[] }>;
  solidInstances: Array<{ instanceId: number | null; solidId: number; status: string; boundsBasis: "verified-linear-vertices" | "vertex-sample-only"; bounds: CadBounds; transform: number[][]; sourceEntityIds: number[] }>;
  centerlines: CadCenterline[];
  issues: Array<{ code: string; severity: string; instanceId?: number | null; sourceEntityIds: number[]; message: string }>;
}
export interface CadPose {
  translationM: CadVector;
  rotationDegrees: CadVector;
}
export interface CadPoseDecision {
  revision: number; recordedAt: string; inputSha256: string; geometryHash: string;
  pose: CadPose; source: "user";
}

export const enum DesktopChannel {
  RunNativeAnalysis = "analysis:native-run",
  CancelNativeAnalysis = "analysis:native-cancel",
  NativeAnalysisPhase = "analysis:native-phase",
  SaveProject = "project:save",
  OpenProject = "project:open",
  SaveChatHistory = "chat-history:save",
  LoadChatHistory = "chat-history:load",
  SaveRecovery = "recovery:save",
  ListRecovery = "recovery:list",
  ReadRecovery = "recovery:read",
  SetTheme = "app:theme",
  GetDeepSeekSettings = "deepseek:settings",
  SaveDeepSeekSettings = "deepseek:save",
  RemoveDeepSeekCredential = "deepseek:remove",
  TestDeepSeekConnection = "deepseek:test",
  ChatDeepSeek = "deepseek:chat",
  CancelDeepSeekChat = "deepseek:chat-cancel",
  ImportStep = "cad:step-import",
  CancelCadImport = "cad:step-cancel",
  ExportCadPreview = "cad:preview-export",
  RecordProjectCheckpoints = "project:checkpoint-record",
  ListProjectCheckpoints = "project:checkpoint-list",
  ReadProjectCheckpoint = "project:checkpoint-read",
  ReadProjectCheckpointEvidence = "project:checkpoint-evidence-read",
  SyncCandidateContext = "project:candidate-context",
  CandidateTool = "project:candidate-tool",
  InspectCandidate = "project:candidate-inspect",
  MergeCandidate = "project:candidate-merge",
  RestoreProjectCheckpoint = "project:controlled-restore",
  PrepareReverseDesign = "reverse-design:prepare",
  ConfirmReverseDesign = "reverse-design:confirm",
  GenerateReverseDesign = "reverse-design:generate",
  RunReverseDesignRound = "reverse-design:run-round",
  CancelReverseDesignRound = "reverse-design:cancel-round",
  VerifyCadImportSource = "cad:source-verify",
  ExportReportWord = "report:word",
  ExportReportPdf = "report:pdf",
  ExportReportData = "report:data",
}

export type AppTheme = "dark" | "light";

export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"] as const;
export type DeepSeekModel = typeof DEEPSEEK_MODELS[number];
export interface DeepSeekSettings {
  configured: boolean;
  model: DeepSeekModel;
  storageAvailable: boolean;
  issue?: "storage-unavailable" | "storage-error";
}
export interface SaveDeepSeekSettingsRequest { model: DeepSeekModel; apiKey: string; }
export type DeepSeekStatus = "saved" | "removed" | "success" | "not-configured" | "invalid-input"
  | "storage-unavailable" | "storage-error" | "authentication" | "balance" | "rate-limit"
  | "timeout" | "network" | "service" | "invalid-response" | "cancelled";
export interface DeepSeekResult {
  status: DeepSeekStatus;
  message: string;
  settings: DeepSeekSettings;
}
export interface DeepSeekToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface DeepSeekAssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
}
export type DeepSeekChatMessage =
  | { role: "system" | "user"; content: string }
  | DeepSeekAssistantMessage
  | { role: "tool"; content: string; tool_call_id: string };
export interface DeepSeekChatRequest { requestId: string; messages: DeepSeekChatMessage[]; }
export interface DeepSeekChatResult {
  status: DeepSeekStatus;
  message: string;
  assistant?: DeepSeekAssistantMessage;
}

export interface SaveProjectRequest {
  path: string | null;
  content: string;
  saveAs?: boolean;
  historyMode?: "copy" | "new";
}

export interface RecoverySaveRequest {
  content: string;
  formalSave: { path: string; savedAt: string } | null;
}
export interface RecoveryEntry {
  id: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  formalSave: RecoverySaveRequest["formalSave"];
  source: "automatic-snapshot";
  matchesFormalSave?: boolean;
}
export interface RecoveryListing { entries: RecoveryEntry[]; issues: string[]; }

export interface ExportReportWordRequest {
  suggestedName: string;
  base64: string;
}

export interface ExportReportPdfRequest {
  suggestedName: string;
  html: string;
}

export type SaveProjectResult =
  | { status: "saved"; path: string; savedAt?: string; content?: string; historyWarning?: string }
  | { status: "cancelled" };

export type OpenProjectResult =
  | { status: "opened"; path: string; content: string; savedAt?: string; historyWarning?: string }
  | { status: "cancelled" };

export interface CadImportRequest {
  /** An explicit path is used for drag-and-drop; null asks the main process to show its picker. */
  path: string | null;
  projectContent: string;
  formalSave: RecoverySaveRequest["formalSave"];
  retryOf?: string;
  parameters?: { coordinateSystem?: "global-right-handed"; lengthUnit?: "m" };
}

export interface ProjectCheckpointRequest {
  projectId: string;
  snapshots: Array<{ kind: "initial" | "save" | "copied-from" | "confirmation-before" | "confirmation-after" | "candidate-round" | "candidate" | "merge-before" | "merge-after" | "restore" | "step-before" | "step-confirmed" | "step-undo" | "step-redo"; content: string; taskId?: string; candidateId?: string; inputSha256?: string; resultSha256?: string; evidenceIndex?: string[]; copiedFrom?: { historyId: string; commit: string }; evidence?: { content: string; sha256: string } }>;
}
export interface ProjectCheckpointRecord {
  schemaVersion: 1; projectId: string; revision: number; kind: ProjectCheckpointRequest["snapshots"][number]["kind"];
  recordedAt: string; contentSha256: string; commit: string; taskId?: string; inputSha256?: string; evidenceSha256?: string;
  candidateId?: string; resultSha256?: string; evidenceIndex?: string[]; copiedFrom?: { historyId: string; commit: string };
}

export interface CandidateContextRequest { content: string; sessionId: string; reason?: "edit" | "restore" | "switch"; }
export interface ProjectCandidate {
  inputPolicy?: "reverse-design-v1";
  schemaVersion: 1; projectId: string; historyId?: string; taskId: string; candidateId: string; retryOf?: string;
  sessionId: string; parentCommit: string; parentRevision: number; parentInputSha256: string; parentContentSha256: string; parentStateSha256: string;
  branch: string; commit: string; createdAt: string; state: "working" | "submitted" | "blocked" | "passed" | "stale" | "cancelled" | "merged";
  inputSha256?: string; resultSha256?: string; evidenceIndex?: string[]; diagnostic?: string; mergedCommit?: string; inspectionSha256?: string;
}
export type CandidateToolRequest = { tool: "fork"; retryOf?: string } | { tool: "submit"; submission: CandidateSubmitRequest } | { tool: "list" } | { tool: "read" | "cancel"; taskId: string };
export type CandidateToolResult = CandidateSnapshot | ProjectCandidate | ProjectCandidate[];
export interface CandidateSubmitRequest {
  projectId: string; taskId: string; content: string; inputSha256: string; resultContent: string; resultSha256: string; evidenceIndex: string[];
}
export interface CandidateSnapshot { candidate: ProjectCandidate; parentContent: string; candidateContent: string; }
export interface ReverseDesignDraft {
  confirmationId: string; parentInputSha256: string; baselineContent: string; initialMassKg: number;
  rules: typeof import("./reverse-design-model").REVERSE_DESIGN_RULES;
  catalog: ReturnType<typeof import("./reverse-design-model").reverseDesignCatalog>;
}
export interface ReverseDesignGenerateRequest { confirmationId: string; beamCatalogId: string; columnCatalogId: string; }
export interface ReverseDesignGenerated { candidate: ProjectCandidate; report: import("./reverse-design-model").ReverseDesignReport; evidenceSha256: string; }
export interface CandidateInspection {
  candidateId: string; commit: string; inputSha256: string; resultSha256: string;
  checks: Array<{ name: string; passed: boolean; value: number; threshold: number; evidenceSha256: string }>;
}

export interface CadKernelInfo {
  name: string;
  version: string;
  build: string;
  license: string;
  runtime: "bundled";
}

export interface CadParsePhase {
  kind: "phase";
  requestId: string;
  record: { stage: "read" | "parse" | "finalize"; startedAt: string };
}

export interface CadParseError {
  code: string;
  message: string;
  stage: "read" | "parse" | "finalize" | "startup";
  entityId?: number;
  line?: number;
  parserVersion?: string;
  kernel?: CadKernelInfo;
}

export interface CadParseResult {
  kind: "result";
  requestId: string;
  parserVersion: string;
  kernel: CadKernelInfo;
  input: { sha256: string; sizeBytes: number; extension: ".step" | ".stp" };
  sourceFile?: { name: string; importedAt: string };
  diagnostics: {
    products: number;
    solidBreps: number;
    assemblyInstances: number;
    entities: number;
    header: { application?: string; schema?: string; units?: string };
    entityCount?: number;
    productCount?: number;
    assemblyInstanceCount?: number;
    solidCount?: number;
    lineCandidateCount?: number;
    unsupportedEntityCount?: number;
    coordinateSystem?: string;
    sourceLengthUnit?: string;
    warnings?: string[];
  };
  intermediateState: {
    schemaVersion: 2;
    source: { inputSha256: string; parserVersion: string };
    entities: Array<{ id: number; type: string; line: number }>;
    normalization: { coordinateSystem: string; lengthUnit: string; deterministic: true };
    units: { sourceLength: string; length: "m"; lengthToM: number; areaToM2: number; inertiaToM4: number; torsionToM4: number; explicit: boolean };
    unitConversions: { length: { sourceToCanonical: number; canonical: "m" }; area: { sourceToCanonical: number; canonical: "m²" }; secondMoment: { sourceToCanonical: number; canonical: "m⁴" }; torsionConstant: { sourceToCanonical: number; canonical: "m⁴" } };
    products: Array<{ id: number; name: string; description: string; definitionId: number | null; sourceEntityIds: number[] }>;
    assemblyTree: Array<{ instanceId: number; parentDefinitionId: number | null; childDefinitionId: number | null; parentProductId: number | null; childProductId: number | null; globalTransform: number[][] }>;
    instances: Array<{ id: number; name: string; parentDefinitionId: number | null; childDefinitionId: number | null; parentProductId: number | null; childProductId: number | null; transform: number[][]; globalTransform: number[][]; sourceEntityIds: number[] }>;
    brepSummaries: Array<{ id: number; shellId: number | null; faceCount: number; surfaceKinds: string[]; sourceEntityIds: number[] }>;
    geometryCandidates: Array<{ id: string; kind: "line"; classification: string; sourceEntityId: number; origin: number[]; direction: number[]; lengthM: number | null; sourceEntityIds: number[] }>;
    instanceGeometryCandidates: Array<{ id: string; kind: "line"; classification: string; sourceEntityId: number; instanceId: number; origin: number[]; direction: number[]; lengthM: number | null; sourceEntityIds: number[] }>;
    candidateNodes: Array<{ id: string; position: number[]; sourceEntityIds: number[] }>;
    candidateMembers: Array<{ id: string; kind: "line"; classification: string; instanceId: number | null; startNodeId: string; endNodeId: string | null; sourceEntityIds: number[]; sectionBasisId: string }>;
    sectionBasis: Array<{ id: string; status: "unresolved"; reason: string; sourceEntityIds: number[] }>;
    sourceMappings: Array<{ sourceEntityIds: number[]; derivedKind: string; derivedIds: Array<number | string> }>;
    diagnostics: { entityCount: number; productCount: number; assemblyInstanceCount: number; solidCount: number; lineCandidateCount: number; unsupportedEntityCount: number; coordinateSystem: string; sourceLengthUnit: string; blockingIssues: string[]; anomalies: Array<{ code: string; severity: string; entityIds?: number[]; count?: number; message?: string }> };
    anomalies: Array<{ code: string; severity: string; entityIds?: number[]; count?: number; message?: string }>;
    warnings: string[];
    ignoredEntities: Array<{ id: number; type: string; reason: string }>;
    geometryHash?: string;
    auditHash?: string;
    engineeringGeometry?: CadEngineeringGeometry;
  };
  audit?: { parserVersion: string; inputSha256: string; parameters: Record<string, unknown>; requestId?: string; recordedAt?: string };
  aiSummary?: string;
}

export type CadImportResult =
  | { status: "cancelled" }
  | { status: "parsed"; path: string; checkpointed: true; phases: CadParsePhase[]; result: CadParseResult }
  | { status: "failed"; path: string; checkpointed: true; phases: CadParsePhase[]; error: CadParseError; requestId: string; retryOf?: string };

export interface FrameMindDesktopApi {
  runNativeAnalysis(request: unknown): Promise<unknown[]>;
  cancelNativeAnalysis(requestId: string): Promise<void>;
  onNativeAnalysisPhase(requestId: string, listener: (message: unknown) => void): () => void;
  saveRecovery(request: RecoverySaveRequest): Promise<void>;
  listRecovery(): Promise<RecoveryListing>;
  readRecovery(id: string): Promise<string>;
  exportReportPdf(request: ExportReportPdfRequest): Promise<SaveProjectResult>;
  exportReportWord(request: ExportReportWordRequest): Promise<SaveProjectResult>;
  exportReportData(request: ExportReportWordRequest): Promise<SaveProjectResult>;
  setTheme(theme: AppTheme): Promise<void>;
  saveProject(request: SaveProjectRequest): Promise<SaveProjectResult>;
  openProject(): Promise<OpenProjectResult>;
  saveChatHistory(request: { projectId: string; content: string }): Promise<void>;
  loadChatHistory(projectId: string): Promise<string | null>;
  getDeepSeekSettings(): Promise<DeepSeekSettings>;
  saveDeepSeekSettings(request: SaveDeepSeekSettingsRequest): Promise<DeepSeekResult>;
  removeDeepSeekCredential(): Promise<DeepSeekResult>;
  testDeepSeekConnection(): Promise<DeepSeekResult>;
  chatDeepSeek(request: DeepSeekChatRequest): Promise<DeepSeekChatResult>;
  cancelDeepSeekChat(requestId: string): Promise<void>;
  importStep(request: CadImportRequest): Promise<CadImportResult>;
  cancelCadImport(requestId: string): Promise<void>;
  exportCadPreview(request: { suggestedName: string; content: string }): Promise<SaveProjectResult>;
  recordProjectCheckpoints(request: ProjectCheckpointRequest): Promise<ProjectCheckpointRecord[]>;
  listProjectCheckpoints(projectId: string): Promise<ProjectCheckpointRecord[]>;
  readProjectCheckpoint(request: { projectId: string; commit: string }): Promise<string>;
  readProjectCheckpointEvidence(request: { projectId: string; commit: string }): Promise<string>;
  syncCandidateContext(request: CandidateContextRequest): Promise<void>;
  prepareReverseDesign(): Promise<ReverseDesignDraft>;
  confirmReverseDesign(confirmationId: string): Promise<string>;
  generateReverseDesign(request: ReverseDesignGenerateRequest): Promise<ReverseDesignGenerated>;
  runReverseDesignRound(confirmationId: string): Promise<import("./reverse-design-round-contract").ReverseDesignRound>;
  cancelReverseDesignRound(): Promise<void>;
  candidateTool(request: CandidateToolRequest): Promise<CandidateToolResult>;
  inspectCandidate(taskId: string): Promise<ProjectCandidate>;
  mergeCandidate(request: { taskId: string; expectedCommit: string }): Promise<string>;
  restoreProjectCheckpoint(selector: { commit?: string; taskId?: string; snapshot?: string }): Promise<string>;
  verifyCadImportSource(request: { requestId: string; inputSha256: string }): Promise<void>;
}
