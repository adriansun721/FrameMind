import { createHash } from "node:crypto";
import { candidateInput, canonicalJson } from "./candidate-model";
import { validateReverseDesignParent } from "./reverse-design-model";
import type { CandidateInspection, CandidateSnapshot } from "./contracts";
import type { CandidateInspector } from "./project-candidates";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export interface ReverseNativeDomain {
  createRequest(content: string): { requestId: string; input: unknown; analysisId: string };
  inspectResult(content: string, request: unknown, messages: unknown[]): { massKg: number; checks: Array<{ name: string; value: number; threshold: number; passed: boolean }> };
  validateProject(content: string): void;
}
export const nativeDomain = (): ReverseNativeDomain => require("./reverse-native-domain.cjs");

/** Both read-only inspect and the merge gate re-read immutable evidence through this boundary. */
export function inspectReverseEvidence(snapshot: CandidateSnapshot, bytes: string, domain: ReverseNativeDomain, runId?: string) {
  const task = snapshot.candidate;
  if (task.inputPolicy !== "reverse-design-v1" || !["submitted", "passed", "blocked"].includes(task.state)) throw new Error("不是可复核的反向设计候选");
  validateReverseDesignParent(snapshot.candidateContent);
  if (hash(bytes) !== task.resultSha256 || hash(candidateInput(snapshot.candidateContent)) !== task.inputSha256) throw new Error("结果证据或输入哈希无效");
  const evidence = JSON.parse(bytes);
  if (typeof evidence.runId !== "string" || runId && evidence.runId !== runId || evidence.taskId !== task.taskId || evidence.candidateId !== task.candidateId || evidence.parentCommit !== task.parentCommit || evidence.parentInputSha256 !== task.parentInputSha256 || evidence.candidateContentSha256 !== hash(snapshot.candidateContent) || evidence.inputSha256 !== task.inputSha256) throw new Error("求解来源无效");
  const expectedRequest = domain.createRequest(snapshot.candidateContent);
  if (!evidence.request || !Array.isArray(evidence.messages) || canonicalJson(expectedRequest.input) !== canonicalJson(evidence.request.input) || hash(canonicalJson(evidence.request.input)) !== evidence.frozenInputSha256 || hash(canonicalJson(evidence.messages.at(-1))) !== evidence.nativeResultSha256) throw new Error("冻结输入或结果哈希不匹配候选");
  const observed = domain.inspectResult(snapshot.candidateContent, evidence.request, evidence.messages);
  if (!Number.isFinite(observed.massKg) || observed.massKg <= 0 || observed.massKg !== evidence.massKg) throw new Error("质量来源不一致");
  const checks = observed.checks.map((check) => ({ ...check, evidenceSha256: task.resultSha256! }));
  return { massKg: observed.massKg, checks };
}

export class ReverseDesignInspector implements CandidateInspector {
  constructor(private readonly domain: () => ReverseNativeDomain = nativeDomain) {}
  validate(content: string): void { this.domain().validateProject(content); }
  async inspect(snapshot: CandidateSnapshot, resultContent: string): Promise<CandidateInspection> {
    const task = snapshot.candidate, observed = inspectReverseEvidence(snapshot, resultContent, this.domain());
    return { candidateId: task.candidateId, commit: task.commit, inputSha256: task.inputSha256!, resultSha256: task.resultSha256!, checks: observed.checks };
  }
}
