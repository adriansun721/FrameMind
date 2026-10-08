# T2-43 验证记录

环境：Windows x64，Node v24.19.0，Electron 44.5.1；生产构建来自当前工作区。固定工具回放只替代远端 AI 传输，桌面、Worker、本地求解和报告导出仍使用真实应用路径。

执行命令及结果：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `node scripts/run-e2e-isolated.cjs e2e/plan2-t2-43-mainlines.spec.ts -g "mainline one"` | 通过，1/1 |
| `node scripts/run-e2e-isolated.cjs e2e/plan2-t2-43-mainlines.spec.ts -g "mainline two"` | 通过，1/1；深色、浅色各完成一轮 |
| `node scripts/verify-plan2-t243.mjs` | 通过，自动化检查 19 项 |

主线一保存了工具调用、隔离试算、确认前工程快照、重启恢复和确认后结果；主线二每个主题保存参数预览、条件预览、变形／内力、引用、截面预览、对比、报告、网络失败和重开文件；随后保存的 `advanced-continuity.json` 记录 AC1／AC2／AC4／AC5 面板、双格式报告和 AC5 重开。`validation.json` 中的 `firstUse` 明确写入 `Pending real participant`。

本记录不把自动回放称为真人试用。T2-42 目标规模性能验收仍为部分完成，已有静力耗时、工作集和高级预算限制见 [T2-42 验收](../T2-42/acceptance.md)。因此 T2-43 的自动化主线证据已通过，但综合任务仍等待真人和依赖任务的最终门槛。
