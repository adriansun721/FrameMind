# T2-27 验证

日期：2026-10-06（Asia/Taipei），本机 Windows x64。方法、阈值、独立解析参考和资源预算预登记于 [ADR-0060](../../../decisions/0060-structural-mass-and-modal-analysis.md)。

- `npm run build:native`、`npm run typecheck`、`npm run build` 通过；Vite 保留既有大 chunk 提示。
- `npm test -- --maxWorkers=2`：75 个文件、578 个测试通过。此前默认并发完整运行出现既有 PDF 导出用例 5 秒超时；该文件独立运行 4/4 通过，降低并发后完整回归通过，没有放宽超时。
- `npx vitest run src/domain/modal.test.ts`：7/7 通过，覆盖真实原生结果、保存解码与显示副本、质量／自重依赖、工具草案确认、公共结果读取、失败和篡改拒绝。
- `node scripts/verify-plan2-t227.mjs`：11 个真实原生案例、347 项检查、5 项结构化失败验证通过。悬臂和简支频率误差 ≤ 5e-4、固定两端 ≤ 0.002，连续体形态相关系数 ≥ 1-1e-6；核查实际 K/M 的残差和质量正交性、四重根子空间及逐轮频率收敛。
- 补充覆盖自由梁 6 个零能模态、简支端释放的独立惯性转角、固定两端从 /2 有效网格开始、旋转局部轴、密度加倍、自重开关、欠细分与方程预算。缺密度、零密度、一般静力荷载作质量来源、初始方程超预算和奇异质量均明确失败。
- `node scripts/run-e2e-isolated.cjs e2e/plan2-t2-16-analysis-cases.spec.ts e2e/plan2-t2-25-releases.spec.ts e2e/plan2-t2-26-mesh.spec.ts e2e/plan2-t2-27-modal.spec.ts`：7/7 通过。旧 T2-16 的“模态未开放”和静力 `/2` 断言已更新为当前模态能力及静力 `/4`；保留荷载复用、过期依赖、删除来源历史重开行为核查。
- T2-27 桌面验证真实手动模态工况、6 阶原生结果、振型切换、0.25 m 显示幅值、保存重开、预算停止和后续失败不覆盖历史。浅深色 1080／1440 截图核查通过；频率表、来源、规模、精度与“非实际位移”说明可见，表格和控制区无截断。

数值明细见 [numerics.json](numerics.json)，桌面记录见 [desktop.json](desktop.json)，保存样本见 [cantilever.framemind](cantilever.framemind)，审查闭环见 [review.md](review.md)。可用 `npm run evidence:plan2:t227` 重建数值证据。

本次只验收结构质量与无阻尼线性模态。附加质量、阻尼、模态计算书、真实 AI 联测、目标规模性能和干净 Windows 安装验收仍由对应后续任务实施。
