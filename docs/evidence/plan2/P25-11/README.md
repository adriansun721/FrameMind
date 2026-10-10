# P25-11 数值门槛、候选比较与 main 决策

真实在线桌面运行：[5cc390e3/run.json](./runs/5cc390e3-ed33-40ae-a913-942eeb3ee016-online/run.json)。三个真实 work 的原生结果由独立 inspect 读取，三个候选均超过水平位移门槛；比较表无可行项，main 为 no-feasible，失败候选的合并调用均被拒绝。正式截面仍为 HEA200 / IPE200。

真实本地 C++ 数值与 Git 门禁运行：[976f605f/run.json](./runs/976f605f-4161-4c94-883c-6d560a31ef69-local-native/run.json)。两轮分别验证无可行候选和通过候选，共五次失败合并拒绝；通过的 HEA200 / HEA200 候选形成结构化请求，错误提交确认被拒，准确提交经确认后合并。AI 明确使用回放，不能替代在线成功减重验收。

每份 manifest 记录新运行身份、源码/构建/原生二进制和产物 SHA-256。本地证据包含候选、冻结请求、原生 wire、逐项检查、比较表、main 决策、拒绝记录与合并回执。独立复验重新组装冻结荷载并核对全部数值与质量来源。

- 专项：`npm run test:plan2:p2511`
- 生成本地证据：`npm run evidence:plan2:p2511`
- 复验本地证据：`node scripts/verify-p25-11.mjs`
- 生成在线证据：`npm run evidence:plan2:p2511:online`
- 复验在线证据：`npx cross-env FRAMEMIND_P2511=1 node scripts/verify-p25-10.mjs`

决策与边界见 [ADR-0082](../../../decisions/0082-p25-numeric-gates-and-main-decision.md)。反馈循环、预算停止和最终恢复交付继续由 P25-12/P25-13 实现。
