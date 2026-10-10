import { createHash, randomUUID } from "node:crypto";
import { candidateInput, parseCandidateProject } from "./candidate-model";
import { createReverseDesignBaseline, generateReverseDesignCandidate, REVERSE_DESIGN_RULES, reverseDesignCatalog, reverseDesignMass, reverseDesignParentState, validateReverseDesignParent } from "./reverse-design-model";
import { ProjectHistoryStore } from "./project-history-store";
import { ProjectCandidates } from "./project-candidates";
import type { CandidateContextRequest, ReverseDesignDraft, ReverseDesignGenerated, ReverseDesignGenerateRequest } from "./contracts";

const hash = (content: string) => createHash("sha256").update(content).digest("hex");
interface Context { content: string; sessionId: string; signature: string; }
interface Confirmation { context: Context; draft: ReverseDesignDraft; confirmed: boolean; busy: boolean; }
/** Host-owned recipe, confirmation and catalog IDs; callers cannot supply a model or limits. */
export class ReverseDesignService {
  private readonly contexts = new Map<number, Context>();
  private readonly confirmations = new Map<number, Confirmation>();
  constructor(private readonly history: ProjectHistoryStore, private readonly candidates: ProjectCandidates) {}
  sync(owner: number, request: CandidateContextRequest): void {
    const signature = hash(reverseDesignParentState(request.content)), previous = this.contexts.get(owner);
    if (previous && previous.signature === signature && previous.sessionId === request.sessionId && !request.reason) { previous.content = request.content; return; }
    this.confirmations.delete(owner);
    this.contexts.set(owner, { content: request.content, sessionId: request.sessionId, signature });
  }
  close(owner: number): void { this.contexts.delete(owner); this.confirmations.delete(owner); }
  private current(owner: number): Context { const c = this.contexts.get(owner); if (!c) throw new Error("请先同步项目上下文"); return c; }
  private confirmation(owner: number, id: string): Confirmation {
    const c = this.confirmations.get(owner);
    if (!c || c.draft.confirmationId !== id || this.current(owner) !== c.context) throw new Error("反向设计确认已过期；请重新预览固定输入");
    return c;
  }
  prepare(owner: number): ReverseDesignDraft {
    const context = this.current(owner), p = parseCandidateProject(context.content);
    const baselineContent = Array.isArray(p.nodes) && p.nodes.length ? (validateReverseDesignParent(context.content), context.content) : createReverseDesignBaseline(context.content);
    const draft: ReverseDesignDraft = { confirmationId: `reverse_${randomUUID()}`, parentInputSha256: hash(candidateInput(context.content)), baselineContent, initialMassKg: reverseDesignMass(baselineContent), rules: { ...REVERSE_DESIGN_RULES }, catalog: reverseDesignCatalog() };
    this.confirmations.set(owner, { context, draft, confirmed: false, busy: false });
    return structuredClone(draft);
  }
  confirmedParent(owner: number, id: string): { content: string; guard(): void } {
    const confirmation = this.confirmation(owner, id);
    if (!confirmation.confirmed || confirmation.busy) throw new Error("请先完成固定输入确认");
    const content = confirmation.context.content;
    return { content, guard: () => {
      if (this.confirmation(owner, id) !== confirmation || reverseDesignParentState(confirmation.context.content) !== reverseDesignParentState(content)) throw new Error("父快照已变化；本轮已过期");
    } };
  }
  async confirm(owner: number, id: string): Promise<string> {
    const confirmation = this.confirmation(owner, id), c = confirmation.context;
    if (confirmation.busy) throw new Error("固定输入确认正在进行");
    if (confirmation.confirmed) return c.content;
    confirmation.busy = true;
    const originalContent = c.content, projectId = String(parseCandidateProject(c.content).id);
    const guard = () => { if (this.confirmation(owner, id) !== confirmation || c.content !== originalContent) throw new Error("父快照已变化，确认已过期"); };
    try {
      const evidenceContent = JSON.stringify({ confirmationId: id, rules: confirmation.draft.rules, catalog: confirmation.draft.catalog, initialMassKg: confirmation.draft.initialMassKg, parentInputSha256: confirmation.draft.parentInputSha256 });
      await this.history.access(projectId, c.content, async () => {
        await this.history.checkpoints.record({ projectId, snapshots: [
          { kind: "confirmation-before", content: c.content },
          { kind: "confirmation-after", content: confirmation.draft.baselineContent, evidence: { content: evidenceContent, sha256: hash(evidenceContent) }, evidenceIndex: ["confirmation.json"] },
        ] }, { beforePublish: async (_records, original) => {
          guard();
          if (original && hash(reverseDesignParentState(await this.history.read(projectId, original))) !== c.signature) throw new Error("Git 父状态已被其他窗口修改；请重开项目");
          guard();
        }, validatePublished: guard, rollback: async () => undefined, committed: async () => {
          c.content = confirmation.draft.baselineContent; c.signature = hash(reverseDesignParentState(c.content)); confirmation.confirmed = true;
          this.candidates.sync(owner, { content: c.content, sessionId: c.sessionId });
        } });
      });
      return c.content;
    } finally { confirmation.busy = false; }
  }
  async generate(owner: number, request: ReverseDesignGenerateRequest): Promise<ReverseDesignGenerated> {
    if (!request || Object.keys(request).length !== 3 || Object.keys(request).some((k) => !["confirmationId", "beamCatalogId", "columnCatalogId"].includes(k))) throw new Error("候选请求只允许确认身份和梁柱库编号");
    const confirmation = this.confirmation(owner, request.confirmationId);
    if (!confirmation.confirmed) throw new Error("请先确认固定输入、变量、目标和预算");
    if (confirmation.busy) throw new Error("候选生成正在进行");
    generateReverseDesignCandidate(confirmation.context.content, { beamCatalogId: request.beamCatalogId, columnCatalogId: request.columnCatalogId });
    confirmation.busy = true;
    let taskId: string | undefined;
    try {
      const snapshot = await this.candidates.fork(owner, undefined, "reverse-design-v1"); taskId = snapshot.candidate.taskId;
      this.confirmation(owner, request.confirmationId);
      const generated = generateReverseDesignCandidate(snapshot.parentContent, { beamCatalogId: request.beamCatalogId, columnCatalogId: request.columnCatalogId });
      const inputSha256 = hash(candidateInput(generated.content));
      const resultContent = JSON.stringify({ ...generated.report, rules: REVERSE_DESIGN_RULES, taskId, candidateId: snapshot.candidate.candidateId, parentCommit: snapshot.candidate.parentCommit, parentInputSha256: snapshot.candidate.parentInputSha256, inputSha256, candidateContentSha256: hash(generated.content), catalogSha256: hash(JSON.stringify(reverseDesignCatalog())), solver: "not-run" });
      const evidenceSha256 = hash(resultContent);
      const candidate = await this.candidates.submit(owner, { projectId: snapshot.candidate.projectId, taskId, content: generated.content, inputSha256, resultContent, resultSha256: evidenceSha256, evidenceIndex: ["result.json"] });
      this.confirmation(owner, request.confirmationId);
      if (candidate.state !== "submitted") throw new Error("候选已过期或取消，输出仅作为证据保留");
      return { candidate, report: generated.report, evidenceSha256 };
    } catch (cause) {
      if (taskId) await this.candidates.cancel(owner, taskId).catch(() => undefined);
      throw cause;
    } finally { confirmation.busy = false; }
  }
}
