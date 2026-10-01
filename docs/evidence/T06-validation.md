# T06 验收记录

- 日期：2026-10-01
- 环境：Windows、Electron，本地分析，无网络或 AI 依赖
- 范围：PLAN.md T06；决策及任务契约见 [ADR-0006](../decisions/0006-t06-analysis-task-isolation.md)

## 任务边界

`src/workspace/analysis-task.test.ts` 验证异步任务在排队阶段取消时拒绝 `AnalysisCancelledError`，验证运行中 Worker 被终止后迟到结果被忽略，并验证取消任务重新运行时旧任务不能解析新任务。求解器抛出的 `AnalysisFailure` 跨任务边界保留阶段和诊断；阶段回调由 `solveFrame` 的实际模型检查、组装、求解和恢复边界发出。生产构建生成独立的 `dist/assets/analysis-worker-*.js`，Electron 页面通过 Worker 执行求解。

`src/workspace/async-guards.test.ts` 和既有 T04/T05 测试验证结果提交仍要求项目身份、会话和精确修订一致。模型编辑或项目切换后，迟到结果不会附加到当前项目；新项目会终止活动任务。任务编号保护重新运行时的忙碌状态清理。

## 真实桌面回归

`npx playwright test e2e/t04-analysis.spec.ts e2e/t05-diagnostics.spec.ts e2e/t06-analysis-task.spec.ts` 通过。T04 在 Electron 中完成空间刚架计算、结果读取、模型编辑后重算及保存重开；T05 在 Electron 中完成模型检查失败、求解失败定位、修正后重算和历史结果保留；T06 通过受控挂起 Worker 验证计算期间相机旋转、节点编辑和选择保持可用，取消不产生结果，取消后可重新运行，且项目版本变化不会被旧任务状态覆盖。

取消入口在计算期间显示为“取消计算”，状态栏显示阶段文字；取消后状态栏明确说明模型与已有结果仍可使用。阶段没有百分比或剩余时间，避免把未测量的精度展示给用户。Worker 计算期间三维视图、选择和属性编辑仍在渲染进程继续处理。

## 复现

```powershell
npm run typecheck
npm test
npm run build
npx playwright test e2e/t04-analysis.spec.ts e2e/t05-diagnostics.spec.ts e2e/t06-analysis-task.spec.ts
```

结果：类型检查、生产构建、71 项单元测试及 3 项 T04/T05/T06 Electron 回归通过。构建保留既有的大 bundle 警告；稠密求解器的规模性能与真实长时计算响应测量属于 T32 的后续固定基准。
