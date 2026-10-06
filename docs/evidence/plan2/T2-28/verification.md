# T2-28 验证

日期：2026-10-06（Asia/Taipei），Windows x64。预登记参考与误差门槛见 [ADR-0061](../../../decisions/0061-explicit-point-and-line-mass.md)。

- `npm run build:native`、`npm run typecheck`、`npm run build` 通过。保留既有 Vite 大 chunk 提示。
- `npx vitest run src/domain/additional-mass.test.ts src/workspace/draft-coordination.test.ts`：12/12 通过。质量事务、校验、单位声明、保存来源、复制分割删除合并、静力不受影响、撤销保留新模态历史，以及节点草案目标和字段冲突均通过公开接口验证。
- `npm test -- --maxWorkers=2`：76 个文件、584 个测试通过。
- `node scripts/verify-plan2-t228.mjs`：14 个真实 C++ 案例、334 项数值检查、5 项失败检查通过。端质量首根 1.2479174096064694，独立首频 4.012719992884193 Hz；频率误差 ≤5e-4、形态绝对相关系数 ≥1-1e-6、映射总量误差 ≤1e-12、实际 K/M 残差和正交误差 ≤1e-8。明细见 [numerics.json](numerics.json)。
- 端释放简支梁请求 6 阶明确 `budget-exhausted/max-divisions`，没有伪报全部模态收敛；另请求 3 阶通过低阶频率收敛检查。该边界及全部逐网格频率保留在数值记录中。
- `node scripts/verify-plan2-t227.mjs`：原结构质量/模态 11 个原生案例、347 项检查、5 项失败回归通过。
- T2-25/26/27/28 共 8 项 Electron 定向回归通过，覆盖释放、网格、模态、质量手动编辑、单位切换、冻结来源、过期、撤销/重做、重开与确定性工具草案确认。回放不计作真实 AI 联测。
- 本轮发现并修复两处闭环问题：撤销会过滤修改后新生成的模态历史；旧目标分类把 `set_node_mass` 误判为杆件命令，导致草案确认禁用。相应公共接口和桌面回归均通过。

桌面记录见 [desktop.json](desktop.json)，保存样本见 [point-and-line.framemind](point-and-line.framemind)，浅深色 1080/1440 来源截图及质量编辑截图同目录。实际截图核查表格、单位、质量来源和属性控件可阅读。

双轴审查结果在最终提交前补充。本任务未宣称随机求解、阻尼、报告、真实 AI、规模性能或安装验收完成。
