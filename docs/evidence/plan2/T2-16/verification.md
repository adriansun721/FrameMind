# T2-16 验证记录

日期：2026-10-05（Asia/Taipei），Windows 本机开发环境。

- `npm run typecheck`、`npm run build:native`、`npm run build` 通过。生产构建沿用已有 bundle 体积提示，未作为新增故障。
- `npm test -- --maxWorkers=4 --reporter=json --outputFile=docs/evidence/plan2/T2-16/unit-tests.json`：完整单元测试 57 文件／456 项通过，0 失败。原始记录见 [unit-tests.json](./unit-tests.json)。包含 Agent 更新当前 AC 来源后保存重开、摘要与分页边界回归。
- `node scripts/verify-plan2-t216.mjs`：11 项通过。6 个原生静力来源回归覆盖节点力、均布、自重、负系数组合、全零组合和空间多杆；5 个错误请求在模型检查阶段失败。数值逐项比较 T2-14 登记参考，仅使用 JSON 对 -0 的标准归零，不增加容差。见 [native-verification.json](./native-verification.json)。
- `e2e/plan2-t2-16-analysis-cases.spec.ts`：真实 Electron/C++ 公开流程通过，包括旧文件迁移、共用荷载的两份原生结果、未参与定义不误过期、共享荷载修改、删除来源后保存重启及冻结历史查看。见 [desktop-verification.json](./desktop-verification.json)、[工况管理](./analysis-case-manager.png)、[删除来源后的历史](./deleted-source-history.png)。
- `git diff --check` 对本任务路径通过。

开发中的首次桌面测试发现 C++ 来源仍按 LC/CB 校验，已扩展为核验 AC 和实际荷载源后通过；另补齐结果面板 AC 标签。测试自身的 option disabled 判定改为核查禁选属性，原生回归按保存 JSON 的零规则比较后通过。以上早期失败不计为验收通过。

相关桌面回归：`node scripts/run-e2e-isolated.cjs e2e/plan2-t2-16-analysis-cases.spec.ts e2e/t12-load-combinations.spec.ts e2e/t15-analysis-comparison.spec.ts e2e/t20-basic-edit-tools.spec.ts --grep "T2-16|T12 edits|T15 keeps|T2-02"`，4 项通过（24.6 秒）。原 T12/T15 的入口／重开步骤补上现有恢复面板处理，数值和历史断言未放宽。

较早的五项桌面运行中，T12/T15 在恢复面板处失败，修复测试入口后上述真实流程通过；另一个旧 T12 pending-worker 用例超时，其替换 `window.Worker` 的等待条件不适用于当前 C++ 正式入口，本次未改写该旧用例，也未计入通过。最终一次默认并发单元运行中，既有 PDF 大批打印测试触及 5 秒超时，随后按 4 worker 完整重跑。本任务不宣称完整 Electron 套件、真实 AI 新能力联测或干净 Windows 验证完成。
