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
  | { status: "saved"; path: string; savedAt?: string }
  | { status: "cancelled" };

export type OpenProjectResult =
  | { status: "opened"; path: string; content: string; savedAt?: string }
  | { status: "cancelled" };

export interface CadImportRequest {
  /** An explicit path is used for drag-and-drop; null asks the main process to show its picker. */
  path: string | null;
  projectContent: string;
  formalSave: RecoverySaveRequest["formalSave"];
  retryOf?: string;
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
  diagnostics: {
    products: number;
    solidBreps: number;
    assemblyInstances: number;
    entities: number;
    header: { application?: string; schema?: string; units?: string };
  };
  intermediateState: {
    schemaVersion: 1;
    source: { inputSha256: string; parserVersion: string };
    entities: Array<{ id: number; type: string; line: number }>;
    warnings: string[];
  };
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
}
