# P25-07 本地项目 Git 历史证据

日期：2026-10-10（Asia/Taipei）

实现边界与事务协议见 [ADR-0078](../../../decisions/0078-p25-project-git-sidecar.md)。本项使用真实本地 Git，不调用在线 AI，也不把接口 fixture 当成多 agent 或 inspect 合并验收。

`runs/<runId>/run.json` 记录输入、构建/源码和产物 SHA-256；每次重跑使用新 runId。桌面运行保存独立仓库复制、新历史、恢复差异、缺历史提示截图与实际 `.framemind` 文件。后端运行的 `validation.json` 保存对 bare 仓库、主分支及无 remote 的独立 Git CLI 检查，以及源码仓库 HEAD、分支引用与索引前后哈希、引用锁故障诊断、旧文件/旧索引/旧历史保持和重试成功记录。早期运行保留当时源码哈希，不冒充最终构建复验。

验证入口：

- `npm run test:plan2:p2507`：真实 Git 与文件存储边界；确认对、复制、新历史、身份不符、未知目录、项目/索引写失败、Git 引用锁、活跃写锁、保存中断恢复及项目文件暂时缺失。
- `npm run evidence:plan2:p2507`：新的真实 Git 故障证据包。
- `npm run build && node scripts/run-e2e-isolated.cjs e2e/p25-07-history.spec.ts e2e/p25-06-import.spec.ts`：项目历史桌面入口及 STEP 确认/撤销/重做/重开回归。
- `node scripts/run-e2e-isolated.cjs e2e/t20-basic-edit-tools.spec.ts`：自然语言基础编辑确认等待 Git checkpoint 后应用。

最终复验：专项 13 项通过；构建及类型检查通过；项目历史、STEP 两场景和自然语言编辑确认的桌面组合回归共 4 项通过。最终证据包的 34 个源码、构建与产物哈希逐项核验通过：

- [真实 Git、引用锁故障及源仓库隔离](./runs/dc3884d5-171d-4e3b-bd29-97d8e1a9d095/run.json)。
- [最终桌面历史、复制、新历史、节点恢复及缺历史提示](./runs/db18b4b3-4f3e-4207-8e51-0958249f8c91/run.json)。
- [双轴审查与修复复查](./review.md)。

本轮全量 Vitest 已执行：94 个文件通过，2 个文件失败；739 项通过，2 项失败。失败是 `src/workspace/result-inspection.test.ts` 与 `src/workspace/stability-report.test.ts` 的原生屈曲结果解码，报“项目包含无效分析结果”。工作区原有原生计算与结果编码/解码改动未纳入本项提交；本项不宣称全量回归全绿。详细摘要见 [verification.json](./verification.json)。

安装包内置 Git、真实候选分支/inspect 合并、指定 STEP 独立 CAD 参考、在线 AI 联测仍由对应后续任务验收。
