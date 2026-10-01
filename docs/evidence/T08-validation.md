# T08 验收记录

- 日期：2026-10-01
- 环境：Windows、Electron，本地模型
- 范围：PLAN.md T08；实现契约见 [ADR-0008](../decisions/0008-t08-batch-history.md)

领域测试覆盖批量节点更新的一次修订号和失败回滚、复制后的唯一身份与杆件引用、节点级联删除，以及撤销/重做和新分支清空 redo。真实 Electron 测试从两个节点和一根杆件开始，多选节点批量移动，验证一次撤销恢复两行、重做同时恢复；随后复制并删除选中节点，确认新身份出现后可删除。

验证命令：

```powershell
npm run typecheck
npm test
npm run build
npx playwright test e2e/t07-synchronized-editing.spec.ts e2e/t08-batch-history.spec.ts
```

结果：类型检查通过；12 个单元测试文件、76 项测试通过；完整 17 项 Electron 回归通过，其中包含 T07 两项和 T08 一项。操作历史是会话内状态，保存重开只验证模型和分析结果，不保存撤销栈。
