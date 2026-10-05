# T2-16 验证记录

日期：2026-10-05（Asia/Taipei），Windows 本机开发环境。

- `npm run typecheck`、`npm run build:native`、`npm run build` 通过。生产构建沿用已有 bundle 体积提示，未作为新增故障。
- `npm test -- --reporter=json --outputFile=docs/evidence/plan2/T2-16/unit-tests.json`：完整单元测试 454 项通过，0 失败。原始记录见 [unit-tests.json](./unit-tests.json)。
- `node scripts/verify-plan2-t216.mjs`：11 项通过。6 个原生静力来源回归覆盖节点力、均布、自重、负系数组合、全零组合和空间多杆；5 个错误请求在模型检查阶段失败。数值逐项比较 T2-14 登记参考，仅使用 JSON 对 -0 的标准归零，不增加容差。见 [native-verification.json](./native-verification.json)。
- `e2e/plan2-t2-16-analysis-cases.spec.ts`：真实 Electron/C++ 公开流程通过，包括旧文件迁移、共用荷载的两份原生结果、未参与定义不误过期、共享荷载修改、删除来源后保存重启及冻结历史查看。见 [desktop-verification.json](./desktop-verification.json)、[工况管理](./analysis-case-manager.png)、[删除来源后的历史](./deleted-source-history.png)。
- `git diff --check` 对本任务路径通过。

开发中的首次桌面测试发现 C++ 来源仍按 LC/CB 校验，已扩展为核验 AC 和实际荷载源后通过；另补齐结果面板 AC 标签。测试自身的 option disabled 判定改为核查禁选属性，原生回归按保存 JSON 的零规则比较后通过。以上早期失败不计为验收通过。

相关 T12/T15/基础 Agent 编辑桌面回归结果在审查完成后登记。本任务不宣称完整 Electron 套件、真实 AI 新能力联测或干净 Windows 验证完成。
