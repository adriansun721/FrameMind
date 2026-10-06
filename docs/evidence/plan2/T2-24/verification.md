# T2-24 验证记录

日期：2026-10-06（Asia/Taipei）。基线：`9bc8f1259f59d2f8d68f5c19651afac09ad5b946`。

- 类型检查与生产构建通过；保留既有 Vite 大包提示。
- 专项单元：`npx vitest run src/components/engineering-scene-model.test.ts src/components/scene-labels.test.ts`，2 文件、18 测试通过，包含审查后宽截面角部与缩小视图拾取修复。
- Electron T2-24 专项通过；UI04 的四项画布、相机、切换和新项目回归通过。
- 全量单元：`npm test`，修复后 71 文件、542 测试通过。
- 扩展 Electron 回归：T2-24、UI04 四项和 T14 结果切换，共 6 项通过；T05／T09 未通过，任务前基线隔离复现同样失败，未标为通过。

## 原有桌面失败隔离

在独立 worktree `.scratch/t224-baseline` 检出任务开始前 `9bc8f12`，使用同一已安装依赖和原生二进制，独立生产构建后运行未修改测试：

- `node scripts/run-e2e-isolated.cjs e2e/t05-diagnostics.spec.ts e2e/t09-uniform-load.spec.ts`：基线与任务后都在 T05 第 18 行失败，中文“模型没有杆件”断言遇到原生 `Missing nodes or members`；之后 T09 第 23 行遇到前一测试自动快照形成的启动恢复页，尚未进入画布。
- 单独新 profile 运行 `node scripts/run-e2e-isolated.cjs e2e/t09-uniform-load.spec.ts`：基线与任务后都通过画布、均布荷载符号像素和相机交互，随后第 61 行旧的三位小数位移文本断言找不到。

这些失败保留为既有桌面套件限制，不修改旧断言使其冒充通过。专项 T2-24 单独 profile 使用规范启动恢复入口验证相同荷载／实体场景；T14 的真实结果切换回归通过。

首次专项尺寸测试发现手工矩阵未设置 `matrixWorldNeedsUpdate`，已修复并复跑通过。首次 Electron 专项使用仅编号匹配完整树行，因行内还包含端点而定位失败；改用公开编号文本后通过。记录失败，不将初次失败记作成功。

视觉检查已查看 solid-dark-1440.png、solid-light-1080.png：控件、实体尺寸相对关系、标签和选中浮层可读。十二张图覆盖深浅主题、1440／1080 宽度、实体／分析线。真实鼠标点击圆截面及保存后分析来源不变见 [desktop.json](./desktop.json)。

新增 1080×680 紧凑窗口后，原鼠标验证位置被可见 B1 标签覆盖，实际选择 B1，符合条件覆盖优先规则；改点圆截面无标签遮挡的沿杆位置后通过。同时补充 50 m 相机距离的不可见像素拾取范围测试，确认 2 mm 实体未增粗。Standards 审查复现宽截面角部漏拾，先添加失败射线测试再补六边形内接半径修正，现通过。

Spec 审查复现小变形结果线及中心线球被实体埋住，结果改为独立覆盖线与 7 px 位置点。真实 Electron 窗口进一步检查 1× 小变形及沿杆位置定位，追加 solid-small-deformation-light-1080-680.png、solid-result-focus-light-1080-680.png。视觉检查发现旧结果图例与新标签说明重叠，已用底部流式栈修复，并通过公开 boundingBox 验证两区不相交。
