# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan2-t2-41-agent.spec.ts >> T2-41 free coordinates and explicit mass survive whole-task restart confirmation
- Location: e2e\plan2-t2-41-agent.spec.ts:14:5

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByRole('region', { name: '完整任务草案' }).getByRole('button', { name: '确认整体任务', exact: true })
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" getByRole('region', { name: '完整任务草案' }).getByRole('button', { name: '确认整体任务', exact: true }) with timeout 5000ms
  - waiting for getByRole('region', { name: '完整任务草案' }).getByRole('button', { name: '确认整体任务', exact: true })

```

```yaml
- main:
  - text: FrameMind
  - button "文件"
  - tablist "工作任务":
    - tab "建模" [selected]
    - tab "荷载" [disabled]
    - tab "分析" [disabled]
    - tab "结果" [disabled]
  - text: T2-22 parameter section reliability.framemind
  - group "面板布局":
    - combobox "单位预设":
      - option "m · kN · GPa" [selected]
      - option "mm · N · MPa"
      - option "mm · kN · MPa"
    - button "切换资源管理器" [pressed]
    - button "切换属性面板" [pressed]
    - button "切换 AI 对话" [pressed]
  - region "当前任务工具":
    - text: 建模
    - toolbar "建模工具":
      - button "选择" [pressed]
      - button "工作平面绘杆": 绘杆
      - button "创建节点": 节点
      - button "显式连接与工程分割": 连接／分割
      - button "参数化截面管理": 参数截面
      - button "近重合检查与节点合并": 节点合并
      - button "创建杆件": 杆件
      - button "创建材料与截面": 材料与截面
      - button "支座"
      - button "荷载"
      - button "运行分析": 计算
      - button "撤销（尚未实现）" [disabled]
      - button "重做（尚未实现）" [disabled]
  - navigation "侧边导航":
    - button "资源管理器" [pressed]
    - button "搜索"
    - button "资源库"
    - button "设置"
  - complementary "项目资源":
    - region "项目树":
      - text: 项目
      - button "添加节点"
      - text: 分析工况
      - combobox "当前分析工况":
        - option "直接计算荷载定义"
        - option "AC1 · 梁柱二阶"
        - option "AC2 · Modal"
        - option "AC3 · Static"
        - option "AC4 · Buckling"
        - option "AC5 · Random" [selected]
      - button "管理分析工况"
      - text: 当前工况
      - combobox "当前工况":
        - option "LC1 · 默认工况" [selected]
      - button "管理工况"
      - text: 当前组合
      - combobox "当前组合":
        - option "独立工况" [selected]
      - button "管理组合"
      - text: T2-22 parameter section
      - button "节点" [expanded]:
        - text: 节点
        - emphasis: "2"
      - checkbox "选择节点 N1"
      - button "N1 0, 0, 0"
      - checkbox "选择节点 N2"
      - button "N2 3, 0, 0"
      - button "杆件" [expanded]:
        - text: 杆件
        - emphasis: "1"
      - checkbox "选择杆件 M1"
      - button "M1 N0001 → N0002"
      - button "材料与截面" [expanded]:
        - text: 材料与截面
        - emphasis: "2"
      - button "材料 M1 · E200"
      - button "截面 S1 · rectangle"
      - button "支座" [expanded]:
        - text: 支座
        - emphasis: "1"
      - button "B1 · N1"
      - button "节点荷载 · LC1" [expanded]:
        - text: 节点荷载 · LC1
        - emphasis: "1"
      - button "L1 · N2"
      - button "杆件均布荷载 · LC1" [expanded]:
        - text: 杆件均布荷载 · LC1
        - emphasis: "0"
      - paragraph: 暂无均布荷载
      - button "结构自重 · LC1" [expanded]:
        - text: 结构自重 · LC1
        - emphasis: "0"
      - button "结构自重 LC1": 未启用 (0, 0, -9.81) m/s²
      - button "荷载工况与组合" [expanded]:
        - text: 荷载工况与组合
        - emphasis: "1"
      - button "切换工况 LC1": LC1 · 默认工况
      - button "计算结果" [expanded]:
        - text: 计算结果
        - emphasis: "5"
      - button "查看分析结果": 分析结果 · AC5 当前
      - button "历史分析与前后对比"
      - button "查看 AC1 结果": AC1 · 当前 · R12
      - button "查看 AC2 结果": AC2 · 当前 · R13
      - button "查看 AC3 结果": AC3 · 当前 · R14
      - button "查看 AC4 结果": AC4 · 当前 · R15
      - button "查看 AC5 结果": AC5 · 当前 · R19
      - button "工程计算书"
  - text: 真实截面 · 透视
  - group "构件显示":
    - button "实体" [pressed]
    - button "分析线"
  - text: 单击选择 · 拖动旋转 · 滚轮缩放
  - button "适合模型"
  - text: "AC5 · Random（PSD / RMS · random） · 结果当前 随机空间系数箭头 · 非瞬时力 · BASE: 全部支承基底加速度 · 源间独立 真实尺寸 · 梁单元分析 标签随缩放避让 · 优先选中与结果对象 · 完整数值见属性"
  - region "对象属性":
    - separator "调整属性面板高度"
    - text: 属性 · 无选择
    - button "收起属性面板"
    - region "统一结果来源":
      - heading "随机响应 · 当前有效" [level=3]
      - term: 分析身份
      - definition: analysis_b344bf77-6fb1-4ff7-8fba-01f766d882b6
      - term: 冻结工况
      - definition: AC5 · Random
      - term: 输入 / 完成状态
      - definition: R19 · converged · 2026-10-07T05:40:30Z
      - term: 显示单位
      - definition: m / kN / kN·m · Hz
      - term: 求解器 / 内部单位
      - definition: framemind-native/8 · m-kN-kN·m
      - paragraph: 零均值平稳随机响应；RMS 为统计均方根，不是瞬时峰值或确定性位移；输入有效频段外为零
      - paragraph: 图形与定位使用本次冻结工程几何；当前属性编辑仍属于当前正式模型。
      - paragraph: 结果比较：不提供跨结果相减。响应叠加：不支持。
      - group: 冻结工程对象与沿杆位置
      - group: 本次运行实际记录
    - heading "随机响应 PSD / RMS" [level=2]
    - paragraph: AC5 · Random · 当前有效
    - paragraph: 零均值平稳随机响应；RMS 为统计均方根，不是瞬时峰值或确定性位移；输入有效频段外为零。不显示为受载变形，不进行 RMS 线性叠加。
    - heading "node_0002 · 平移 Y" [level=3]
    - paragraph:
      - text: RMS：
      - strong: 0.0091127749 m
      - text: · 全局 XYZ · 单边 Hz
    - button "定位响应节点"
    - img "节点平移响应 PSD 曲线": 0 Hz 25 Hz 0.0001460179 m²/Hz（曲线最大 PSD）
    - paragraph: 输入源间关系：独立；同源空间作用相干相加。
    - paragraph: 响应参考系：全局 XYZ · 相对整体平动基底（不含基底位移）。仅输出选定节点平移 PSD / RMS。
    - paragraph: 源 BASE · PSD1 · (m/s²)²/Hz（基底加速度自谱）
    - paragraph:
      - text: 整体一致平动基底 · 适用支承 node_0001 · 全局方向 (0, 1, 0) · 系数 1
      - button "定位基底支承 node_0001"
    - paragraph: 积分频段 0–25 Hz · 梯形积分 · 1313 个实际频点。曲线超过 1000 点时仅显示分桶极值，原始数值完整保存。
    - group: 模态、阻尼和精度来源
    - group: 响应 PSD 数值
  - complementary "AI 对话":
    - text: Framer
    - button "历史对话"
    - button "新建对话"
    - button "清空对话"
    - button "收起 AI 对话"
    - log "对话消息":
      - article:
        - paragraph: 读取正式节点身份后，准备一次确认的整体草案：把 N2 移到 (-0.25, 1.5, 4.25) m 并设置节点附加质量125 kg；保留其余工程输入。不计算，不改截面。
        - region "处理过程":
          - button "收起处理过程" [expanded]
          - list:
            - listitem: 请求已中断
            - listitem:
              - text: 处理未完成
              - paragraph: DeepSeek 账户余额不足
        - text: 处理失败 · DeepSeek 账户余额不足
        - status: 正常探索 · 预算 240 秒 · 活动 1 秒 · 等待 0 秒 · 轮次 1 · 调用 0 · 候选 0 · 分析 0
        - paragraph: 已确认模型和成功结果保留，本地编辑与计算可继续。本次任务未提交模型修改。
        - button "重试消息"
        - button "打开连接设置"
    - textbox "AI 消息草稿"
    - button "添加附件或插件"
    - group "探索深度":
      - button "正常" [pressed]
      - button "深度"
    - button "发送消息" [disabled]
  - separator "调整项目面板宽度"
  - separator "调整 AI 对话面板宽度"
  - status: 已打开 reliability.framemind 当前选择 无选择 2 节点 1 杆件 长度 m 全局坐标系 · Z 向上
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import { readFile } from "node:fs/promises";
  3   | import { decodeProject } from "../src/domain/project-file";
  4   | import { selectAnalysisCase, updateAnalysisCase } from "../src/domain/project";
  5   | import { engineeringContent } from "../src/workspace/draft-coordination";
  6   | import { agentFixture } from "./agent-integration";
  7   | import { save } from "./frame-proposal-actions";
  8   | import type { AiTaskResult } from "../src/workspace/ai-task";
  9   | 
  10  | const model = () => readFile("docs/evidence/plan2/T2-36/all-methods.framemind", "utf8").then(decodeProject);
  11  | const uses = (result: AiTaskResult, name: string) => result.records.some((r) => r.call.function.name === name && r.result.status === "completed");
  12  | test.setTimeout(360_000);
  13  | 
  14  | test("T2-41 free coordinates and explicit mass survive whole-task restart confirmation", async () => {
  15  |   const project = await model();
  16  |   await agentFixture("geometry", { task: "T2-41", project }, async ({ page, project, path, restart, check, ask }) => {
  17  |     const operations = [{ type: "update_node", id: "node_0002", position: { x: -0.25, y: 1.5, z: 4.25 } }, { type: "set_node_mass", id: "node_0002", massKg: 125 }];
  18  |     const result = await ask(page, "读取正式节点身份后，准备一次确认的整体草案：把 N2 移到 (-0.25, 1.5, 4.25) m 并设置节点附加质量125 kg；保留其余工程输入。不计算，不改截面。", [[{ name: "read_model", input: { collection: "nodes" } }], [{ name: "propose_task", input: { edits: { operations, source: "user" } } }]], "整体草案已准备，等待确认。");
  19  |     check("identity", result.taskDraft?.edits?.operations.some((o) => "id" in o && o.id === "node_0002") === true);
  20  |     check("confirmation", result.status === "awaiting-confirmation" && result.taskDraft?.edits?.source === "user");
  21  |     check("unchangedBeforeConfirm", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
  22  |     page = await restart();
  23  |     await page.getByRole("button", { name: "恢复任务", exact: true }).click();
  24  |     const card = page.getByRole("region", { name: "完整任务草案" });
> 25  |     await expect(card.getByRole("button", { name: "确认整体任务", exact: true })).toBeEnabled();
      |                                                                             ^ Error: expect(locator).toBeEnabled() failed
  26  |     check("restart", (await save(page, path)).nodes[1].additionalMassKg === undefined);
  27  |     await card.getByRole("button", { name: "确认整体任务", exact: true }).dblclick();
  28  |     await expect(card).toHaveCount(0);
  29  |     const after = await save(page, path);
  30  |     const expected = structuredClone(project);
  31  |     expected.nodes[1].position = { x: -0.25, y: 1.5, z: 4.25 }; expected.nodes[1].additionalMassKg = 125;
  32  |     check("completed", JSON.stringify(engineeringContent(after)) === JSON.stringify(engineeringContent(expected)));
  33  |     check("once", after.confirmedOperations.length === 1 && after.revision === project.revision + 1);
  34  |   });
  35  | });
  36  | 
  37  | test("T2-41 missing mass is clarified without invented engineering inputs", async () => {
  38  |   await agentFixture("mass", { task: "T2-41", project: await model() }, async ({ page, project, path, check, ask }) => {
  39  |     const result = await ask(page, "请给 N2 加一台设备的附加质量，设备质量和单位尚未提供。先读取节点身份，缺参请询问我，不要猜数值，不要默认取自重，不要计算或修改模型。", [[{ name: "read_model", input: { collection: "nodes" } }]], "请提供设备质量数值和单位。");
  40  |     check("read", uses(result, "read_model"));
  41  |     check("clarified", /质量/.test(result.assistant ?? "") && /单位/.test(result.assistant ?? "") && /提供|多少|请问|确认/.test(result.assistant ?? ""));
  42  |     check("noGuess", !result.taskDraft?.edits && !result.modelEdits && !result.analysisRequested);
  43  |     check("unchanged", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
  44  |   });
  45  | });
  46  | 
  47  | test("T2-41 buckling keeps fixed preload separate from reference scaling", async () => {
  48  |   await agentFixture("buckling", { task: "T2-41", project: selectAnalysisCase(await model(), "AC4") }, async ({ page, project, path, check, ask }) => {
  49  |     const definition = project.analysisCases.find((c) => c.id === "AC4")!;
  50  |     const properties = { name: definition.name, method: definition.method, loadSourceId: definition.loadSourceId, settings: { ...definition.settings, buckling: { ...definition.settings.buckling!, fixed: [{ loadCaseId: "LC1", factor: 0.25 }], reference: [{ loadCaseId: "LC1", factor: 1 }] } } };
  51  |     const result = await ask(page, "请读取分析工况后准备整体草案：AC4 屈曲的固定荷载设为 LC1×0.25，参考荷载 LC1×1；保留其他求解设置。固定荷载不随λ放大。确认后计算 AC4，不优化截面，不作规范结论。", [[{ name: "read_model", input: { collection: "analysis-cases" } }], [{ name: "propose_task", input: { edits: { source: "user", operations: [{ type: "update_analysis_case", id: "AC4", properties }] }, analysis: { requested: true, source: "user", sourceId: "AC4" } } }]], "固定与参考荷载已分别列入整体草案，确认后计算。");
  52  |     const operation = result.taskDraft?.edits?.operations.find((o) => o.type === "update_analysis_case");
  53  |     check("read", uses(result, "read_model"));
  54  |     check("fixedReference", operation?.type === "update_analysis_case" && JSON.stringify(operation.properties) === JSON.stringify(properties));
  55  |     check("confirmation", result.status === "awaiting-confirmation" && result.taskDraft?.edits?.source === "user");
  56  |     check("unchanged", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
  57  |     await page.getByRole("region", { name: "完整任务草案" }).getByRole("button", { name: "确认整体任务", exact: true }).click();
  58  |     await expect(page.getByTestId("ai-turn-status").last()).toContainText("本地分析完成", { timeout: 30_000 });
  59  |     const after = await save(page, path);
  60  |     const solved = after.analysisResults.at(-1), original = project.analysisResults.find((r) => r.input.analysisCase?.id === "AC4")!;
  61  |     check("actualCompleted", after.analysisResults.length === project.analysisResults.length + 1 && solved?.buckling?.convergence.status === "converged" && solved.input.analysisCase.id === "AC4" && Math.abs(solved.buckling.modes[0].factor - (original.buckling!.modes[0].factor - .25)) < original.buckling!.modes[0].factor * .005);
  62  |     const citation = await ask(page, "读取刚刚完成的 AC4 新结果，核对第1阶屈曲因子并用 N2 作为定位锚点给出真实引用；说明固定荷载不随λ放大及归一化形态不是真实位移。不要修改或作规范结论。", [[{ name: "read_results", input: { collection: "summary" } }], [{ name: "read_result", input: { kind: "node", id: "node_0002", quantity: "bucklingFactor", component: "scalar", modeNumber: 1 } }]], "计算事实 [[result:t211-2-0]]；固定荷载不随λ放大，归一化形态不是真实位移。");
  63  |     check("newCitation", citation.status === "completed" && citation.records.some((r) => r.result.reference?.analysisId === solved.id && citation.assistant?.includes(r.result.reference.token)));
  64  |   });
  65  | });
  66  | 
  67  | test("T2-41 failed second-order trial preserves formal results and diagnostics", async () => {
  68  |   let project = selectAnalysisCase(await model(), "AC1");
  69  |   const definition = project.analysisCases.find((c) => c.id === "AC1")!;
  70  |   project = updateAnalysisCase(project, "AC1", { name: definition.name, method: definition.method, loadSourceId: definition.loadSourceId, settings: { ...definition.settings, secondOrder: { ...definition.settings.secondOrder!, maxIterations: 1 } } });
  71  |   await agentFixture("second-order", { task: "T2-41", project }, async ({ page, project, path, check, ask }) => {
  72  |     const result = await ask(page, "当前 AC1 二阶 maxIterations=1。请读取设置，在诊断副本中按原输入试算 AC1，核查是否收敛。失败时保留诊断并说明不能发布正式成功结果；不要改工程、自动增加迭代预算、自动优化截面或作规范结论。", [[{ name: "read_model", input: { collection: "analysis-cases" } }], [{ name: "create_diagnostic_copy", input: {} }], [{ name: "run_diagnostic_trial", input: { label: "二阶失败核查", sourceId: "AC1", operations: [] } }]], "诊断副本二阶试算失败，未收敛；不能发布正式成功结果，也不能据此作规范结论。");
  73  |     const trial = result.diagnosticTrial;
  74  |     check("trial", uses(result, "run_diagnostic_trial") && trial?.status === "failed" && !trial.result);
  75  |     check("source", result.diagnosticCopy?.source.projectId === project.id && result.diagnosticCopy.id !== project.id);
  76  |     check("evidence", Boolean(trial?.evidence.diagnostics.length) && /失败|未收敛/.test(result.assistant ?? ""));
  77  |     const after = await save(page, path);
  78  |     check("isolation", JSON.stringify(engineeringContent(after)) === JSON.stringify(engineeringContent(project)) && JSON.stringify(after.analysisResults) === JSON.stringify(project.analysisResults));
  79  |     const definition = project.analysisCases.find((c) => c.id === "AC1")!;
  80  |     const properties = { name: definition.name, method: definition.method, loadSourceId: definition.loadSourceId, settings: { ...definition.settings, secondOrder: { ...definition.settings.secondOrder!, maxIterations: 20 } } };
  81  |     const recovery = await ask(page, "现在由我明确指定修复：准备整体草案，把 AC1 maxIterations 改为20，保留其余设置和模型。确认后计算 AC1，不自动改变荷载、截面或其他预算。", [[{ name: "read_model", input: { collection: "analysis-cases" } }], [{ name: "propose_task", input: { edits: { source: "user", operations: [{ type: "update_analysis_case", id: "AC1", properties }] }, analysis: { requested: true, source: "user", sourceId: "AC1" } } }]], "用户指定的修复草案已准备，等待确认后计算。");
  82  |     check("recoveryDraft", recovery.status === "awaiting-confirmation" && recovery.taskDraft?.edits?.source === "user");
  83  |     await page.getByRole("region", { name: "完整任务草案" }).getByRole("button", { name: "确认整体任务", exact: true }).click();
  84  |     await expect(page.getByTestId("ai-turn-status").last()).toContainText("本地分析完成", { timeout: 30_000 });
  85  |     const restored = await save(page, path), solved = restored.analysisResults.at(-1);
  86  |     check("recovered", restored.analysisResults.length === project.analysisResults.length + 1 && solved.secondOrder?.status === "converged" && solved.input.analysisCase.id === "AC1");
  87  |   });
  88  | });
  89  | 
  90  | test("T2-41 negative spectrum is refused with real preparation failure evidence", async () => {
  91  |   await agentFixture("spectrum", { task: "T2-41", project: await model() }, async ({ page, project, path, check, ask }) => {
  92  |     const input = { format: "table", metadata: { name: "非法输入", quantity: "force", excitationUnit: "kN", frequencyUnit: "Hz", densityUnit: "kN²/Hz", sidedness: "one-sided", band: [1, 2], interpolation: "linear", outsideBand: "zero" }, points: [{ frequency: 1, density: -1 }, { frequency: 2, density: 1 }] };
  93  |     const result = await ask(page, "用 prepare_psd_input 核查输入 PSD：力、kN、Hz、kN²/Hz、单边、有效频段[1,2]Hz、分段线性、频段外零，点(1,-1)、(2,1)。必须核查非法负密度，不取绝对值，不保存资源，不计算响应。", [[{ name: "prepare_psd_input", input }]], "输入谱含负密度，校验失败；不能保存或计算响应。");
  94  |     check("failure", result.records.some((r) => r.call.function.name === "prepare_psd_input" && r.result.status === "failed"));
  95  |     check("explained", /负|非负/.test(result.assistant ?? ""));
  96  |     check("noGuess", !result.taskDraft && !result.modelEdits && !result.analysisRequested);
  97  |     check("unchanged", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
  98  |   });
  99  | });
  100 | 
  101 | test("T2-41 random source relationship must be clarified before adding sources", async () => {
  102 |   await agentFixture("relationship", { task: "T2-41", project: selectAnalysisCase(await model(), "AC5") }, async ({ page, project, path, check, ask }) => {
  103 |     const result = await ask(page, "读取 AC5 和输入谱。想再加一个与现有方向相同、谱相同的基底作用，但我还没说明它是同一随机过程还是独立源。先问清源关系，不能因谱相同假定同源，也不能默认独立或直接叠加RMS。不要计算，不改模型。", [[{ name: "read_model", input: { collection: "analysis-cases" } }, { name: "read_model", input: { collection: "psd-spectra" } }]], "新增作用与现有作用是同一随机过程还是独立源？请明确源关系。");
  104 |     check("read", uses(result, "read_model"));
  105 |     check("clarified", /同一|同源/.test(result.assistant ?? "") && /独立/.test(result.assistant ?? "") && /请|确认|还是|\?/.test(result.assistant ?? ""));
  106 |     check("noGuess", !result.taskDraft && !result.modelEdits && !result.analysisRequested);
  107 |     check("unchanged", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
  108 |   });
  109 | });
  110 | 
  111 | test("T2-41 real citations bind all five saved methods to frozen engineering identities", async () => {
  112 |   await agentFixture("citations", { task: "T2-41", project: await model() }, async ({ page, project, path, check, ask }) => {
  113 |     for (const [id, quantity, component] of [["AC1", "displacement", "y"], ["AC2", "frequency", "scalar"], ["AC3", "displacement", "y"], ["AC4", "bucklingFactor", "scalar"], ["AC5", "rms", "y"]] as const) {
  114 |       await page.getByLabel("当前分析工况", { exact: true }).selectOption(id);
  115 |       const analysis = project.analysisResults.find((r) => r.input.analysisCase?.id === id)!;
  116 |       const input = { kind: "node", id: "node_0002", quantity, component, ...(["AC2", "AC4"].includes(id) ? { modeNumber: 1 } : {}) };
  117 |       const result = await ask(page, `读取当前 ${id} 的真实结果摘要，再核对 N2 的 ${quantity}/${component}${"modeNumber" in input ? "，第1阶" : ""}，给出真实引用 token；说明分析身份、冻结输入与方法含义，不做规范或安全结论。不修改模型。`, [[{ name: "read_results", input: { collection: "summary" } }], [{ name: "read_result", input }]], "计算事实 [[result:t211-2-0]]；该引用绑定冻结输入，不构成安全或规范结论。");
  118 |       const references = result.records.flatMap((r) => r.result.reference ? [r.result.reference] : []);
  119 |       check(`${id}:citation`, result.status === "completed" && references.some((ref) => ref.analysisId === analysis.id && ref.object.id === "node_0002" && result.assistant?.includes(ref.token)));
  120 |     }
  121 |     check("unchanged", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));
  122 |   });
  123 | });
  124 | 
```