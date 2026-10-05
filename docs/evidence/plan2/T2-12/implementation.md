# T2-12 实现与复跑

日期：2026-10-05（Asia/Taipei）。任务基点：`ce3550f`。

服务契约和职责见 [ADR-0045](../../../decisions/0045-unified-static-analysis-service.md)。正式入口保留 TypeScript 静力，通过版本化请求冻结输入，记录来源、工况依赖、配置和真实阶段。手动、agent 续算、诊断副本及报告补算共用服务；旧直接调用及旧项目兼容保留。

```powershell
npm run evidence:plan2:t212
npx vitest run src/domain/analysis-service.test.ts src/workspace/analysis-task.test.ts src/workspace/diagnostic-trial.test.ts
npm test
```

`numerical-results.json` 包含未经调整的 22 个独立静力算例、7 个失败算例和 2,322 项检查。`wire-samples.json` 是后续原生桥接可核对的实际请求／返回样本。`desktop-result.json` 与 `static-process.png` 验证真实 Electron Worker、来源保存重开及 Word 同源阶段。

`desktop-regression.json` 保存逐用例独立资料目录的 22 项桌面回归日志。`desktop-regression-initial.json` 保留首轮失败及重跑记录；旧 T04 用例在自身重启后被恢复页挡住，补上既有 `enterWorkbenchWithoutRecovery` 步骤后通过。此前一次共用资料目录的联合运行有 10 项启动／重启阻塞；独立目录消除其他用例间的恢复快照污染，未改产品恢复策略。全量单元测试为 52 文件／413 测试通过。

审查结果见 [review.md](./review.md)，标准轴两项协议校验问题均已修复并独立复查，需求轴无发现。完整验证摘要见 [verification.md](./verification.md)。

首轮新桌面测试在报告步骤使用了错误的对话框可访问名称，等待“导出工程计算书”超时。实际名称为“工程计算书”；修正选择器后重跑。此前的真实计算、过程与保存断言均已通过。没有据此修改产品界面或求解器。

本轮不添加原生数值库，也不把确定性回放当作真实 AI 联测。T2-13—T2-15、T2-41／T2-44 继续承担原生、扩展联测和干净安装验收。
