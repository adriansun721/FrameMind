# P25-08 候选隔离与恢复证据

日期：2026-10-10（Asia/Taipei）

设计与权限边界见 [ADR-0079](../../../decisions/0079-p25-candidate-isolation.md)。本项验证本地真实 Git 分支、父快照保护、三方差异和回滚；数值 inspect 和真实多 agent 联测由后续任务交付。

- `npm run test:plan2:p2508`：候选工具、父绑定、状态转换、迟到输出、重试、检查报告门控、合并引用锁故障、发布期间取消补偿、恢复和复制/重开。
- `npm run evidence:plan2:p2508`：构建、真实 Git 协议证据、真实桌面入口；每次产生新 runId。
- `npm test -- --maxWorkers=2`：完整单元测试。

`runs/<runId>/run.json` 保存源码、构建、输入和产物哈希及复验入口。后端包包含真实分支图、拒绝任意命令记录、未检查拒绝、引用锁失败保持、受控合并前后和任务回滚。后端成功门控使用明确标识的内部 protocol checker fixture，不是工程数值检查、在线 AI 或多 agent 成功证据。桌面包保存真实项目、三方差异/人工冲突/任务回滚截图及检查未接入时禁止合并的记录。早期包保留原源码哈希；最终包及测试摘要见 verification.json。
