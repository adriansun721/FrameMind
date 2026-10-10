# P25-06 本地实现与验证证据

日期：2026-10-10（Asia/Taipei）。最终指定 STEP 验收仍待上游几何/独立 CAD 基准、完整 P25-07 和真实在线联测完成。

## 可复验行为

- 草稿与父项目绑定，过期、修改来源、未完成/无效 AI 核验不可应用。
- 解析棱柱整组替换，生成现有 `.framemind` 格式、来源映射和确认回执。
- Git 锁故障时正式模型和可见 checkpoint 不出现半组成功。
- 项目与完整草稿证据在发布 Git 引用前回读核验，证据哈希错误也不会发布确认；草稿包含原始 AI 结构化响应，可独立导出。
- 导入整体撤销、重做、checkpoint 恢复；重开不自动恢复旧任务。
- 恢复前展示对象增删与字段差异，变化的当前项目会使已查看的恢复预览失效。
- 缺支座/荷载时持续显示未就绪；删除原 STEP 或项目历史目录后仍可打开正式模型。
- 指定 STEP 保持上游阻塞，只保存待修复草稿；保存重开保留资源参数并清除旧核验。

运行记录在 `runs/<run-id>/run.json`，每次运行有独立 ID、输入/构建/源码/产物 SHA-256。`mode: replay-transport` 的棱柱成功路径不是真实在线 AI 证据；`mode: local-blocked` 的指定 STEP 只证明阻塞与草稿恢复。失败或未完成目录不作为通过证据。

## 复验命令

```powershell
npm run typecheck
npx vitest run src/workspace/cad-import.test.ts src/workspace/project-snapshot-diff.test.ts electron/project-checkpoints.test.ts electron/cad-import-sources.test.ts --maxWorkers=2
npm run build
node scripts/run-e2e-isolated.cjs e2e/p25-06-import.spec.ts e2e/p25-05-resources.spec.ts e2e/project-lifecycle.spec.ts
npm test -- --maxWorkers=2
```

全量测试记录位于 `validation/<run-id>/unit-tests.json`。全量失败与本次范围的关系会在最终验证记录中单独列明，不以局部通过替代全量结果。

## 本次最终本地验证

成功路径：[aeae60bd](./runs/aeae60bd-d64d-49e6-8a8b-6d74632bfa56/run.json)；指定 STEP 阻塞与恢复：[249b8e4d](./runs/249b8e4d-e0f8-4163-9649-c7efb46fdfb3/run.json)。类型检查与生产构建通过，新增 10 个测试通过（[最终定向测试](./validation/fd5da6e5-83d5-497c-af0d-5f614a3bc329/final-targeted-tests.json)）。相关 P25-05/P25-06/项目生命周期的 6 个 Electron 测试通过；最后的草稿叶字段校验与差异排版修正后，再次通过 P25-06 的 2 项桌面测试。最新运行包含自动保存的完整 `cad-draft.json` 与恢复差异截图。

全量测试 [8d69b299](./validation/8d69b299-0f6f-4bf9-8a2c-1ca7a644d2af/unit-tests.json) 为 730/732 通过。两个失败分别是 `result-inspection.test.ts` 的屈曲引用和 `stability-report.test.ts` 的屈曲计算书，均在既有 `decodeAnalysisResult` → `decodeBucklingResult` 路径返回“项目包含无效分析结果”。排除 P25-06 解码接入、保留工作区其他既有修改与原生二进制的隔离基线同样复现了这两项失败，见 [baseline-tests.json](./validation/8d69b299-0f6f-4bf9-8a2c-1ca7a644d2af/baseline-tests.json)。基线解码模块 SHA-256：`a8cfef4370bc3bc2f423c63c5fc3583a56057a6939d2119c5681b5ca6a6dbfc1`。本次不修改该屈曲路径，也不宣称全量测试全绿。

审查修正后的[全量复跑](./validation/fd5da6e5-83d5-497c-af0d-5f614a3bc329/unit-tests.json) 为 732/734 通过，仍仅上述两项失败。之后新增的损坏叶字段回归断言在最终定向测试中通过。[双轴审查记录](./review.md) 列出发现、修正和复审结论。

## 限制

当前使用本机 Git，独立 bare 仓库位于应用数据目录。它不随项目文件移动；历史复制与安装包内 Git 交付属于 P25-07/P25-16。完整中间态与 AI 回执随确认 checkpoint 保存，正式项目保存其摘要与哈希。原 STEP、完整 CAD 参考和本机历史丢失后，项目内工程对象及来源摘要仍可读取，原几何或历史提交无法完整复核。
