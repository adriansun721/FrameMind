/**
 * Project-scoped task scheduling shared by agent work, local analysis and
 * future diagnostic runs. The scheduler owns ordering and identity; callers
 * own the actual work and must return a promise from `execute`.
 */

export type ScheduledTaskKind = "agent" | "analysis" | "diagnostic" | "conversation";
export type ScheduledTaskStatus =
  | "queued"
  | "running"
  | "waiting-input"
  | "waiting-confirmation"
  | "paused"
  | "failed"
  | "cancelled"
  | "completed";
export type ScheduledTaskRelation = "new" | "supplement" | "ambiguous";

export interface ScheduledTaskDescriptor {
  id: string;
  projectId: string;
  kind: ScheduledTaskKind;
  goal: string;
  lastGoal?: string;
  status: ScheduledTaskStatus;
  parentTaskId?: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  queuedRevision?: number;
  startedRevision?: number;
  supplementCount: number;
  operationCount: number;
  phase?: string;
  analysisId?: string;
  error?: string;
}

export interface ScheduledTaskOwnership {
  projectId: string;
  taskId: string;
  kind: ScheduledTaskKind;
  analysisId?: string;
}

export interface ScheduledTaskEvent<TResult = unknown> {
  type: "created" | "status" | "phase" | "result" | "finished";
  at: number;
  task: ScheduledTaskDescriptor;
  ownership: ScheduledTaskOwnership;
  result?: TResult;
  error?: string;
}

export interface ScheduledTaskContext<TInput> {
  readonly ownership: ScheduledTaskOwnership;
  readonly signal: AbortSignal;
  readonly input: TInput;
  reportPhase(phase: string): void;
  setStatus(status: Extract<ScheduledTaskStatus, "running" | "waiting-input" | "waiting-confirmation" | "paused" | "failed" | "cancelled">): void;
  setKind(kind: ScheduledTaskKind): void;
  bindAnalysis(analysisId: string): void;
}

export interface ScheduledTaskSubmission<TInput, TResult> {
  projectId: string;
  kind: ScheduledTaskKind;
  goal: string;
  relation?: ScheduledTaskRelation;
  parentTaskId?: string;
  queuedRevision?: number;
  analysisId?: string;
  /** Read the current project only when the task obtains the resource slot. */
  getInput(): TInput;
  execute(input: TInput, context: ScheduledTaskContext<TInput>): Promise<TResult>;
}

export interface ScheduledTaskHandle<TResult> {
  taskId: string;
  /** The id of the task that owns this operation. Supplements share this id. */
  ownerTaskId: string;
  relation: Exclude<ScheduledTaskRelation, "ambiguous">;
  promise: Promise<TResult>;
  cancel(): void;
}

export interface TaskSchedulerOptions {
  maxConcurrent?: number;
  now?(): number;
  createId?(): string;
}

export interface TaskSchedulerSnapshot {
  active: ScheduledTaskDescriptor[];
  queued: ScheduledTaskDescriptor[];
}

export class AmbiguousTaskAssignmentError extends Error {
  readonly projectId: string;
  readonly candidates: readonly ScheduledTaskDescriptor[];

  constructor(projectId: string, candidates: readonly ScheduledTaskDescriptor[]) {
    super("请明确这是当前任务的补充还是独立的新任务");
    this.name = "AmbiguousTaskAssignmentError";
    this.projectId = projectId;
    this.candidates = candidates;
  }
}

export class UnknownScheduledTaskError extends Error {
  constructor(taskId: string) {
    super(`任务 ${taskId} 不存在`);
    this.name = "UnknownScheduledTaskError";
  }
}

interface PendingOperation<TInput, TResult> {
  submission: ScheduledTaskSubmission<TInput, TResult>;
  resolve(value: TResult): void;
  reject(error: unknown): void;
  cancelled: boolean;
  completed: boolean;
}

interface InternalTask<TInput, TResult> {
  descriptor: ScheduledTaskDescriptor;
  operations: PendingOperation<TInput, TResult>[];
  controller?: AbortController;
  running: boolean;
  waitingStatus?: Extract<ScheduledTaskStatus, "waiting-input" | "waiting-confirmation" | "paused">;
}

type Listener<TResult> = (event: ScheduledTaskEvent<TResult>) => void;

const TERMINAL: readonly ScheduledTaskStatus[] = ["failed", "cancelled", "completed"];

function isTerminal(status: ScheduledTaskStatus): boolean {
  return TERMINAL.includes(status);
}

function cloneDescriptor(descriptor: ScheduledTaskDescriptor): ScheduledTaskDescriptor {
  return { ...descriptor };
}

/** A deterministic, FIFO resource scheduler. It deliberately has no React or Electron dependency. */
export class TaskScheduler<TInput, TResult> {
  private readonly maxConcurrent: number;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly tasks = new Map<string, InternalTask<TInput, TResult>>();
  private readonly listeners = new Set<Listener<TResult>>();
  private readonly queue: string[] = [];
  private runningCount = 0;

  constructor(options: TaskSchedulerOptions = {}) {
    const maxConcurrent = options.maxConcurrent ?? 1;
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("任务资源并发数必须是正整数");
    this.maxConcurrent = maxConcurrent;
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? (() => `task_${crypto.randomUUID()}`);
  }

  subscribe(listener: Listener<TResult>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  submit(submission: ScheduledTaskSubmission<TInput, TResult>): ScheduledTaskHandle<TResult> {
    const relation = submission.relation ?? "new";
    if (!submission.projectId.trim()) throw new Error("任务必须绑定项目身份");
    if (!submission.goal.trim()) throw new Error("任务目标不能为空");
    if (relation === "ambiguous") {
      const candidates = this.findProjectTasks(submission.projectId).map((task) => cloneDescriptor(task.descriptor));
      throw new AmbiguousTaskAssignmentError(submission.projectId, candidates);
    }

    let task: InternalTask<TInput, TResult> | undefined;
    let effectiveRelation: Exclude<ScheduledTaskRelation, "ambiguous"> = relation;
    if (relation === "supplement") {
      const parent = submission.parentTaskId
        ? this.tasks.get(submission.parentTaskId)
        : this.findSupplementTarget(submission.projectId, submission.kind);
      if (!parent || isTerminal(parent.descriptor.status)
        || parent.descriptor.projectId !== submission.projectId
        || parent.descriptor.kind !== submission.kind) {
        throw new Error("当前没有可补充的活动任务，请明确提交独立任务");
      }
      task = parent;
      task.descriptor.supplementCount += 1;
      task.descriptor.operationCount += 1;
      task.descriptor.lastGoal = submission.goal.trim();
      this.emit({ type: "status", task, ownership: this.ownership(task), at: this.now() });
    } else {
      const descriptor: ScheduledTaskDescriptor = {
        id: this.createId(), projectId: submission.projectId, kind: submission.kind,
        goal: submission.goal.trim(), status: "queued", parentTaskId: submission.parentTaskId,
        queuedAt: this.now(), queuedRevision: submission.queuedRevision,
        supplementCount: 0, operationCount: 1, analysisId: submission.analysisId,
      };
      task = { descriptor, operations: [], running: false };
      this.tasks.set(descriptor.id, task);
      this.queue.push(descriptor.id);
      this.emit({ type: "created", task, ownership: this.ownership(task), at: this.now() });
    }

    const ownerTaskId = task.descriptor.id;
    let resolve!: (value: TResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<TResult>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    const operation: PendingOperation<TInput, TResult> = { submission, resolve, reject, cancelled: false, completed: false };
    task.operations.push(operation);
    if (relation === "supplement" && !task.running && !this.queue.includes(ownerTaskId)) this.queue.push(ownerTaskId);
    this.pump();
    return {
      taskId: ownerTaskId, ownerTaskId, relation: effectiveRelation, promise,
      cancel: () => this.cancelOperation(ownerTaskId, operation),
    };
  }

  get(taskId: string): ScheduledTaskDescriptor | undefined {
    const task = this.tasks.get(taskId);
    return task ? cloneDescriptor(task.descriptor) : undefined;
  }

  snapshot(projectId?: string): TaskSchedulerSnapshot {
    const descriptors = [...this.tasks.values()]
      .filter((task) => !projectId || task.descriptor.projectId === projectId)
      .filter((task) => !isTerminal(task.descriptor.status))
      .map((task) => cloneDescriptor(task.descriptor));
    return {
      active: descriptors.filter((task) => task.status !== "queued"),
      queued: descriptors.filter((task) => task.status === "queued"),
    };
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new UnknownScheduledTaskError(taskId);
    this.cancelTask(task);
  }

  /** Resolve a task that stopped at a user-controlled waiting state. */
  complete(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new UnknownScheduledTaskError(taskId);
    if (isTerminal(task.descriptor.status)) return;
    if (task.running) throw new Error(`任务 ${taskId} 仍在运行，不能提前完成`);
    if (!["waiting-input", "waiting-confirmation", "paused"].includes(task.descriptor.status)) return;
    for (const operation of task.operations) {
      if (!operation.cancelled && !operation.completed && operation.submission.relation === "supplement") {
        this.cancelOperation(taskId, operation);
      }
    }
    if (task.operations.some((operation) => !operation.cancelled && !operation.completed)) {
      throw new Error(`任务 ${taskId} 仍有未完成操作，不能提前完成`);
    }
    this.setStatus(task, "completed");
    task.waitingStatus = undefined;
    task.descriptor.finishedAt = this.now();
    this.emit({ type: "finished", task, ownership: this.ownership(task), at: this.now() });
    queueMicrotask(() => this.pump());
  }

  cancelProject(projectId: string): void {
    for (const task of this.findProjectTasks(projectId)) this.cancel(task.descriptor.id);
  }

  private findProjectTasks(projectId: string): InternalTask<TInput, TResult>[] {
    return [...this.tasks.values()].filter((task) => task.descriptor.projectId === projectId && !isTerminal(task.descriptor.status));
  }

  private findSupplementTarget(projectId: string, kind: ScheduledTaskKind): InternalTask<TInput, TResult> | undefined {
    const candidates = this.findProjectTasks(projectId).filter((task) => task.descriptor.kind === kind);
    return candidates.find((task) => task.running) ?? candidates.find((task) => task.descriptor.status === "paused")
      ?? candidates.sort((left, right) => left.descriptor.queuedAt - right.descriptor.queuedAt)[0];
  }

  private ownership(task: InternalTask<TInput, TResult>): ScheduledTaskOwnership {
    return { projectId: task.descriptor.projectId, taskId: task.descriptor.id, kind: task.descriptor.kind, analysisId: task.descriptor.analysisId };
  }

  private emit(event: Omit<ScheduledTaskEvent<TResult>, "task" | "ownership"> & { task: InternalTask<TInput, TResult>; ownership?: ScheduledTaskOwnership }): void {
    const snapshot: ScheduledTaskEvent<TResult> = { ...event, task: cloneDescriptor(event.task.descriptor), ownership: event.ownership ?? this.ownership(event.task) };
    for (const listener of this.listeners) listener(snapshot);
  }

  private setStatus(task: InternalTask<TInput, TResult>, status: ScheduledTaskStatus, error?: string): void {
    if (isTerminal(task.descriptor.status) && task.descriptor.status !== status) return;
    task.descriptor.status = status;
    if (error) task.descriptor.error = error;
    this.emit({ type: "status", task, ownership: this.ownership(task), at: this.now(), error });
  }

  private cancelOperation(taskId: string, operation: PendingOperation<TInput, TResult>): void {
    if (operation.cancelled || operation.completed) return;
    operation.cancelled = true;
    const task = this.tasks.get(taskId);
    if (!task) return;
    operation.reject(new Error("任务已取消"));
    if (task.running) task.controller?.abort();
    if (operation.submission.relation !== "supplement") {
      this.cancelTask(task);
    } else {
      const remaining = task.operations.some((item) => !item.cancelled && !item.completed);
      if (task.waitingStatus) {
        if (task.descriptor.status !== task.waitingStatus) this.setStatus(task, task.waitingStatus);
        if (remaining) {
          if (!task.running && !this.queue.includes(taskId)) this.queue.push(taskId);
        } else {
          const queueIndex = this.queue.indexOf(taskId);
          if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
        }
      } else if (!remaining) {
        if (!task.running && ["waiting-input", "waiting-confirmation", "paused"].includes(task.descriptor.status)) {
          // Cancelling a queued supplement must not cancel the waiting owner.
        } else {
          this.cancelTask(task);
        }
      }
    }
    this.pump();
  }

  private cancelTask(task: InternalTask<TInput, TResult>): void {
    for (const operation of task.operations) {
      if (operation.cancelled || operation.completed) continue;
      operation.cancelled = true;
      operation.reject(new Error("任务已取消"));
    }
    const queueIndex = this.queue.indexOf(task.descriptor.id);
    if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
    task.controller?.abort();
    if (!isTerminal(task.descriptor.status)) {
      this.setStatus(task, "cancelled");
      task.waitingStatus = undefined;
      task.descriptor.finishedAt = this.now();
      this.emit({ type: "finished", task, ownership: this.ownership(task), at: this.now() });
    }
    this.pump();
  }

  private pump(): void {
    while (this.runningCount < this.maxConcurrent) {
      const taskId = this.queue.find((id) => {
        const task = this.tasks.get(id);
        return Boolean(task && !task.running && !isTerminal(task.descriptor.status) && !this.projectHasActiveTask(task)
          && task.operations.some((operation) => !operation.cancelled && !operation.completed));
      });
      if (!taskId) return;
      const index = this.queue.indexOf(taskId);
      if (index >= 0) this.queue.splice(index, 1);
      const task = this.tasks.get(taskId);
      if (task) void this.run(task);
    }
  }

  private projectHasActiveTask(task: InternalTask<TInput, TResult>): boolean {
    return [...this.tasks.values()].some((other) => other !== task && other.descriptor.projectId === task.descriptor.projectId
      && !isTerminal(other.descriptor.status) && other.descriptor.status !== "queued");
  }

  private async run(task: InternalTask<TInput, TResult>): Promise<void> {
    const operation = task.operations.find((item) => !item.cancelled && !item.completed);
    if (!operation || task.running || isTerminal(task.descriptor.status)) { this.pump(); return; }
    task.running = true;
    this.runningCount += 1;
    task.controller = new AbortController();
    task.waitingStatus = ["waiting-input", "waiting-confirmation", "paused"].includes(task.descriptor.status)
      ? task.descriptor.status as Extract<ScheduledTaskStatus, "waiting-input" | "waiting-confirmation" | "paused">
      : undefined;
    let input: TInput;
    try {
      // This call is intentionally inside run: queued work observes the latest model.
      input = operation.submission.getInput();
      task.descriptor.startedAt ??= this.now();
      const inputRecord = input as { revision?: unknown; projectRevision?: unknown };
      const inputRevision = typeof inputRecord?.projectRevision === "number" ? inputRecord.projectRevision : inputRecord?.revision;
      if (typeof inputRevision === "number") task.descriptor.startedRevision = inputRevision;
      this.setStatus(task, "running");
      const context: ScheduledTaskContext<TInput> = {
        ownership: this.ownership(task), signal: task.controller.signal, input,
        reportPhase: (phase) => { task.descriptor.phase = phase; this.emit({ type: "phase", task, ownership: this.ownership(task), at: this.now() }); },
        setStatus: (status) => this.setStatus(task, status),
        setKind: (kind) => { task.descriptor.kind = kind; },
        bindAnalysis: (analysisId) => { task.descriptor.analysisId = analysisId; },
      };
      const result = await operation.submission.execute(input, context);
      if (operation.cancelled || task.controller?.signal.aborted) return;
      operation.completed = true;
      operation.resolve(result);
      this.emit({ type: "result", task, ownership: this.ownership(task), at: this.now(), result });
      if (task.descriptor.status === "cancelled") {
        task.descriptor.finishedAt = this.now();
        this.emit({ type: "finished", task, ownership: this.ownership(task), at: this.now(), result });
        return;
      }
      const remaining = task.operations.some((item) => !item.cancelled && !item.completed);
      if (remaining) {
        task.descriptor.phase = undefined;
        this.queue.push(task.descriptor.id);
        return;
      }
      if (["waiting-input", "waiting-confirmation", "paused"].includes(task.descriptor.status)) {
        task.descriptor.phase = undefined;
        task.waitingStatus = task.descriptor.status as Extract<ScheduledTaskStatus, "waiting-input" | "waiting-confirmation" | "paused">;
        return;
      }
      this.setStatus(task, "completed");
      task.waitingStatus = undefined;
      task.descriptor.finishedAt = this.now();
      this.emit({ type: "finished", task, ownership: this.ownership(task), at: this.now(), result });
    } catch (error) {
      if (!operation.cancelled && !task.controller?.signal.aborted && task.descriptor.status !== "cancelled") {
        const message = error instanceof Error ? error.message : String(error);
        operation.reject(error);
        operation.completed = true;
        for (const pending of task.operations) {
          if (pending === operation || pending.cancelled || pending.completed) continue;
          pending.completed = true;
          pending.reject(error);
        }
        this.setStatus(task, "failed", message);
        task.descriptor.finishedAt = this.now();
        this.emit({ type: "finished", task, ownership: this.ownership(task), at: this.now(), error: message });
      }
    } finally {
      task.running = false; task.controller = undefined; this.runningCount -= 1;
      // Let result subscribers publish the completed input before the next task captures a snapshot.
      queueMicrotask(() => this.pump());
    }
  }
}
