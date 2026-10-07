import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decodeProject } from "../src/domain/project-file";
import { selectAnalysisCase, updateAnalysisCase } from "../src/domain/project";
import { NATIVE_SECOND_ORDER_SOLVER } from "../src/domain/analysis";
import { engineeringContent } from "../src/workspace/draft-coordination";
import { agentFixture } from "./agent-integration";
import { save } from "./frame-proposal-actions";
import type { AiTaskResult } from "../src/workspace/ai-task";

const model = () => readFile("docs/evidence/plan2/T2-36/all-methods.framemind", "utf8").then(decodeProject);
const uses = (result: AiTaskResult, name: string) => result.records.some((r) => r.call.function.name === name && r.result.status === "completed");
test.setTimeout(360_000);

test("T2-41 free coordinates and explicit mass survive whole-task restart confirmation", async () => {
  const project = await model();
  await agentFixture("geometry", { task: "T2-41", project }, async ({ page, project, path, restart, check, ask }) => {
    const operations = [{ type: "update_node", id: "node_0002", position: { x: -0.25, y: 1.5, z: 4.25 } }, { type: "set_node_mass", id: "node_0002", massKg: 125 }];
    const result = await ask(page, "读取正式节点身份后，准备一次确认的整体草案：把 N2 移到 (-0.25, 1.5, 4.25) m 并设置节点附加质量125 kg；保留其余工程输入。不计算，不改截面。", [[{ name: "read_model", input: { collection: "nodes" } }], [{ name: "propose_task", input: { edits: { operations, source: "user" } } }]], "整体草案已准备，等待确认。");
    check("identity", result.taskDraft?.edits?.operations.some((o) => "id" in o && o.id === "node_0002") === true);
    check("confirmation", result.status === "awaiting-confirmation" && result.taskDraft?.edits?.source === "user");
    check("unchangedBeforeConfirm", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
    page = await restart();
    await page.getByRole("button", { name: "恢复任务", exact: true }).click();
    const card = page.getByRole("region", { name: "完整任务草案" });
    await expect(card.getByRole("button", { name: "确认整体任务", exact: true })).toBeEnabled();
    check("restart", (await save(page, path)).nodes[1].additionalMassKg === undefined);
    await card.getByRole("button", { name: "确认整体任务", exact: true }).dblclick();
    await expect(card).toHaveCount(0);
    const after = await save(page, path);
    const expected = structuredClone(project);
    expected.nodes[1].position = { x: -0.25, y: 1.5, z: 4.25 }; expected.nodes[1].additionalMassKg = 125;
    check("completed", JSON.stringify(engineeringContent(after)) === JSON.stringify(engineeringContent(expected)));
    check("once", after.confirmedOperations.length === 1 && after.revision === project.revision + 1);
  });
});

test("T2-41 missing mass is clarified without invented engineering inputs", async () => {
  await agentFixture("mass", { task: "T2-41", project: await model() }, async ({ page, project, path, check, ask }) => {
    const result = await ask(page, "请给 N2 加一台设备的附加质量，设备质量和单位尚未提供。先读取节点身份，缺参请询问我，不要猜数值，不要默认取自重，不要计算或修改模型。", [[{ name: "read_model", input: { collection: "nodes" } }]], "请提供设备质量数值和单位。");
    check("read", uses(result, "read_model"));
    check("clarified", /质量/.test(result.assistant ?? "") && /单位/.test(result.assistant ?? "") && /提供|多少|请问|确认/.test(result.assistant ?? ""));
    check("noGuess", !result.taskDraft?.edits && !result.modelEdits && !result.analysisRequested);
    check("unchanged", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
  });
});

test("T2-41 buckling keeps fixed preload separate from reference scaling", async () => {
  await agentFixture("buckling", { task: "T2-41", project: selectAnalysisCase(await model(), "AC4") }, async ({ page, project, path, check, ask }) => {
    const definition = project.analysisCases.find((c) => c.id === "AC4")!;
    const properties = { name: definition.name, method: definition.method, loadSourceId: definition.loadSourceId, settings: { ...definition.settings, buckling: { ...definition.settings.buckling!, fixed: [{ loadCaseId: "LC1", factor: 0.25 }], reference: [{ loadCaseId: "LC1", factor: 1 }] } } };
    const result = await ask(page, "请读取分析工况后准备整体草案：AC4 屈曲的固定荷载设为 LC1×0.25，参考荷载 LC1×1；保留其他求解设置。固定荷载不随λ放大。确认后计算 AC4，不优化截面，不作规范结论。", [[{ name: "read_model", input: { collection: "analysis-cases" } }], [{ name: "propose_task", input: { edits: { source: "user", operations: [{ type: "update_analysis_case", id: "AC4", properties }] }, analysis: { requested: true, source: "user", sourceId: "AC4" } } }]], "固定与参考荷载已分别列入整体草案，确认后计算。");
    const operation = result.taskDraft?.edits?.operations.find((o) => o.type === "update_analysis_case");
    check("read", uses(result, "read_model"));
    check("fixedReference", operation?.type === "update_analysis_case" && JSON.stringify(operation.properties) === JSON.stringify(properties));
    check("confirmation", result.status === "awaiting-confirmation" && result.taskDraft?.edits?.source === "user");
    check("unchanged", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
    await page.getByRole("region", { name: "完整任务草案" }).getByRole("button", { name: "确认整体任务", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("本地分析完成", { timeout: 30_000 });
    const after = await save(page, path);
    const solved = after.analysisResults.at(-1), original = project.analysisResults.find((r) => r.input.analysisCase?.id === "AC4")!;
    check("actualCompleted", after.analysisResults.length === project.analysisResults.length + 1 && solved?.buckling?.convergence.status === "converged" && solved.input.analysisCase.id === "AC4" && Math.abs(solved.buckling.modes[0].factor - (original.buckling!.modes[0].factor - .25)) < original.buckling!.modes[0].factor * .005);
    const citation = await ask(page, "读取刚刚完成的 AC4 新结果，核对第1阶屈曲因子并用 N2 作为定位锚点给出真实引用；说明固定荷载不随λ放大及归一化形态不是真实位移。不要修改或作规范结论。", [[{ name: "read_results", input: { collection: "summary" } }], [{ name: "read_result", input: { kind: "node", id: "node_0002", quantity: "bucklingFactor", component: "scalar", modeNumber: 1 } }]], "计算事实 [[result:t211-2-0]]；固定荷载不随λ放大，归一化形态不是真实位移。");
    check("newCitation", citation.status === "completed" && citation.records.some((r) => r.result.reference?.analysisId === solved.id && citation.assistant?.includes(r.result.reference.token)));
  });
});

test("T2-41 failed second-order trial preserves formal results and diagnostics", async () => {
  let project = selectAnalysisCase(await model(), "AC1");
  const definition = project.analysisCases.find((c) => c.id === "AC1")!;
  project = updateAnalysisCase(project, "AC1", { name: definition.name, method: definition.method, loadSourceId: definition.loadSourceId, settings: { ...definition.settings, secondOrder: { ...definition.settings.secondOrder!, maxIterations: 1 } } });
  await agentFixture("second-order", { task: "T2-41", project }, async ({ page, project, path, check, ask }) => {
    const result = await ask(page, "当前 AC1 二阶 maxIterations=1。请读取设置，在诊断副本中按原输入试算 AC1，核查是否收敛。失败时保留诊断并说明不能发布正式成功结果；不要改工程、自动增加迭代预算、自动优化截面或作规范结论。", [[{ name: "read_model", input: { collection: "analysis-cases" } }], [{ name: "create_diagnostic_copy", input: {} }], [{ name: "run_diagnostic_trial", input: { label: "二阶失败核查", sourceId: "AC1", operations: [] } }]], "诊断副本二阶试算失败，未收敛；不能发布正式成功结果，也不能据此作规范结论。");
    const trial = result.diagnosticTrial;
    check("trial", uses(result, "run_diagnostic_trial") && trial?.status === "failed" && !trial.result);
    check("source", result.diagnosticCopy?.source.projectId === project.id && result.diagnosticCopy.id !== project.id
      && trial?.evidence.sourceId === "AC1" && trial.evidence.service?.sourceId === "AC1"
      && trial.evidence.service?.solver.implementation === NATIVE_SECOND_ORDER_SOLVER.implementation);
    check("evidence", Boolean(trial?.evidence.diagnostics.length) && /失败|未收敛/.test(result.assistant ?? ""));
    const after = await save(page, path);
    check("isolation", JSON.stringify(engineeringContent(after)) === JSON.stringify(engineeringContent(project)) && JSON.stringify(after.analysisResults) === JSON.stringify(project.analysisResults));
    const definition = project.analysisCases.find((c) => c.id === "AC1")!;
    const properties = { name: definition.name, method: definition.method, loadSourceId: definition.loadSourceId, settings: { ...definition.settings, secondOrder: { ...definition.settings.secondOrder!, maxIterations: 20 } } };
    const recovery = await ask(page, "现在由我明确指定修复：准备整体草案，把 AC1 maxIterations 改为20，保留其余设置和模型。确认后计算 AC1，不自动改变荷载、截面或其他预算。", [[{ name: "read_model", input: { collection: "analysis-cases" } }], [{ name: "propose_task", input: { edits: { source: "user", operations: [{ type: "update_analysis_case", id: "AC1", properties }] }, analysis: { requested: true, source: "user", sourceId: "AC1" } } }]], "用户指定的修复草案已准备，等待确认后计算。");
    check("recoveryDraft", recovery.status === "awaiting-confirmation" && recovery.taskDraft?.edits?.source === "user");
    await page.getByRole("region", { name: "完整任务草案" }).getByRole("button", { name: "确认整体任务", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("本地分析完成", { timeout: 30_000 });
    const restored = await save(page, path), solved = restored.analysisResults.at(-1);
    check("recovered", restored.analysisResults.length === project.analysisResults.length + 1 && solved.secondOrder?.status === "converged" && solved.input.analysisCase.id === "AC1");
  });
});

test("T2-41 negative spectrum is refused with real preparation failure evidence", async () => {
  await agentFixture("spectrum", { task: "T2-41", project: await model() }, async ({ page, project, path, check, ask }) => {
    const input = { format: "table", metadata: { name: "非法输入", quantity: "force", excitationUnit: "kN", frequencyUnit: "Hz", densityUnit: "kN²/Hz", sidedness: "one-sided", band: [1, 2], interpolation: "linear", outsideBand: "zero" }, points: [{ frequency: 1, density: -1 }, { frequency: 2, density: 1 }] };
    const result = await ask(page, "用 prepare_psd_input 核查输入 PSD：力、kN、Hz、kN²/Hz、单边、有效频段[1,2]Hz、分段线性、频段外零，点(1,-1)、(2,1)。必须核查非法负密度，不取绝对值，不保存资源，不计算响应。", [[{ name: "prepare_psd_input", input }]], "输入谱含负密度，校验失败；不能保存或计算响应。");
    check("failure", result.records.some((r) => r.call.function.name === "prepare_psd_input" && r.result.status === "failed"));
    check("explained", /负|非负/.test(result.assistant ?? ""));
    check("noGuess", !result.taskDraft && !result.modelEdits && !result.analysisRequested);
    check("unchanged", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
  });
});

test("T2-41 random source relationship must be clarified before adding sources", async () => {
  await agentFixture("relationship", { task: "T2-41", project: selectAnalysisCase(await model(), "AC5") }, async ({ page, project, path, check, ask }) => {
    const result = await ask(page, "读取 AC5 和输入谱。想再加一个与现有方向相同、谱相同的基底作用，但我还没说明它是同一随机过程还是独立源。先问清源关系，不能因谱相同假定同源，也不能默认独立或直接叠加RMS。不要计算，不改模型。", [[{ name: "read_model", input: { collection: "analysis-cases" } }, { name: "read_model", input: { collection: "psd-spectra" } }]], "新增作用与现有作用是同一随机过程还是独立源？请明确源关系。");
    check("read", uses(result, "read_model"));
    check("clarified", /同一|同源/.test(result.assistant ?? "") && /独立/.test(result.assistant ?? "") && /请|确认|还是|\?/.test(result.assistant ?? ""));
    check("noGuess", !result.taskDraft && !result.modelEdits && !result.analysisRequested);
    check("unchanged", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
  });
});

test("T2-41 real citations bind all five saved methods to frozen engineering identities", async () => {
  await agentFixture("citations", { task: "T2-41", project: await model() }, async ({ page, project, path, check, ask }) => {
    for (const [id, quantity, component] of [["AC1", "displacement", "y"], ["AC2", "frequency", "scalar"], ["AC3", "displacement", "y"], ["AC4", "bucklingFactor", "scalar"], ["AC5", "rms", "y"]] as const) {
      await page.getByLabel("当前分析工况", { exact: true }).selectOption(id);
      const analysis = project.analysisResults.find((r) => r.input.analysisCase?.id === id)!;
      const input = { kind: "node", id: "node_0002", quantity, component, ...(["AC2", "AC4"].includes(id) ? { modeNumber: 1 } : {}) };
      const result = await ask(page, `读取当前 ${id} 的真实结果摘要，再核对 N2 的 ${quantity}/${component}${"modeNumber" in input ? "，第1阶" : ""}，给出真实引用 token；说明分析身份、冻结输入与方法含义，不做规范或安全结论。不修改模型。`, [[{ name: "read_results", input: { collection: "summary" } }], [{ name: "read_result", input }]], "计算事实 [[result:t211-2-0]]；该引用绑定冻结输入，不构成安全或规范结论。");
      const references = result.records.flatMap((r) => r.result.reference ? [r.result.reference] : []);
      check(`${id}:citation`, result.status === "completed" && references.some((ref) => ref.analysisId === analysis.id
        && ref.inputRevision === analysis.input.projectRevision && ref.source.id === id && ref.object.id === "node_0002"
        && ref.quantity === quantity && ref.component === component && ref.modeNumber === ("modeNumber" in input ? input.modeNumber : undefined)
        && result.assistant?.includes(ref.token)));
    }
    check("unchanged", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
  });
});
