# P25-09：固定两层钢架与受控截面候选

日期：2026-10-10（Asia/Taipei）

最终通过运行：[44913dec-7e80-4ed4-9977-c90321645733/run.json](./runs/44913dec-7e80-4ed4-9977-c90321645733/run.json)。这是实际 Electron 桌面和本机项目 Git 的运行；未调用 AI，也未将回放或普通文本视作求解/可行性证据。

桌面入口为“文件 → 反向设计固定场景”。确认前正式模型为空，确认后为 PRD2.5 的 12 节点、16 杆件钢架。梁选择 IPE100 后生成独立 `candidate/task_<uuid>` 分支，主历史仅记录父模型；未检查候选无法合并，保存与重开仍保留 HEA200/IPE200 正式截面。重开使旧候选过期，并要求重新确认。

输入、父快照、候选和保存后的项目分别保存在 `initial.framemind`、`parent.framemind`、`candidate.framemind` 和 `saved.framemind`。`result.json` 记录任务/候选/父提交、输入和目录哈希、前后截面及来源、逐杆质量与自重。`validation.json` 记录实际候选分支、合并拒绝和重开状态；两张 PNG 只提供界面佐证。manifest 对输入、产物、源文件及构建资产分别记录 SHA-256。

独立质量参考：柱 24 m，梁 40 m，ρ=7850 kg/m³。初始 `7850×(24×0.00538+40×0.00285)=1908.492 kg`；梁改 IPE100 后为 `7850×(24×0.00538+40×0.00103)=1337.012 kg`，减少 571.480 kg。IPE100 自重全局 qz 为 -0.079318755 kN/m。项目只保留既有自重规则，求解入口读取新面积时会重新计算，不额外叠加生成报告的自重。

候选报告为 `blocked`、`solver: not-run`。15 mm 水平合位移是已确认约束，尚无实算位移/可行性结论。真实多 agent、数值 inspect、可行候选比较和预算执行分别属于 P25-10、P25-11、P25-12；本演示不包含强度、屈曲或规范验算，也不保证全局最优。

验证记录：

- `npm run typecheck`、`npm run build`：通过。
- 仅导出暂存的源文件、配置和所需 fixture 到独立临时目录，两份 TypeScript 配置均通过；本次提交不依赖工作区原有未提交修改。
- `npx vitest run electron/reverse-design.test.ts electron/project-candidates.test.ts --maxWorkers=2`：30 项通过；跨窗口加固后的 P25-09 13 项重新通过。
- `node scripts/run-e2e-isolated.cjs e2e/p25-09-reverse-design.spec.ts`：最终真实桌面流程通过。
- `node scripts/verify-p25-09.mjs`：最终运行的产物与代码/构建哈希、固定字段、质量、自重和来源一致性通过。
- `npm test -- --maxWorkers=2`：98 文件，773 项通过、2 项失败。失败是已有 `src/workspace/result-inspection.test.ts` 的屈曲因子引用和 `src/workspace/stability-report.test.ts` 的固定/参考屈曲报告，均报“项目包含无效分析结果”，栈为 `project-file.ts:347 → buckling.ts:97`。这些测试及调用路径没有本次修改，相关领域文件在任务开始时已有未提交改动；单独重跑复现同样失败。本任务不将全量测试标为通过。

复验：`npm run evidence:plan2:p2509` 创建新的独立 run ID。已有最终证据可执行 `node scripts/verify-p25-09.mjs`；源文件或构建哈希变化时必须新跑，不能用旧运行冒充本次通过。其他运行目录保留各自状态；早期测试失败没有被标成通过。

设计决策：[ADR-0080](../../../decisions/0080-p25-reverse-design-fixed-candidates.md)。审查记录：[review.md](./review.md)。
