# T2-24 验证记录

日期：2026-10-06（Asia/Taipei）。基线：`9bc8f1259f59d2f8d68f5c19651afac09ad5b946`。

- 类型检查与生产构建通过；保留既有 Vite 大包提示。
- 专项单元：`npx vitest run src/components/engineering-scene-model.test.ts src/components/scene-labels.test.ts`，2 文件、16 测试通过。
- Electron T2-24 专项通过；UI04 的四项画布、相机、切换和新项目回归通过。
- 全量单元：`npm test`，71 文件、540 测试通过。
- 扩展 Electron 回归：T2-24、UI04 四项和 T14 结果切换，共 6 项通过；T05／T09 未通过，正在用任务前基线隔离复现，未标为通过。

首次专项尺寸测试发现手工矩阵未设置 `matrixWorldNeedsUpdate`，已修复并复跑通过。首次 Electron 专项使用仅编号匹配完整树行，因行内还包含端点而定位失败；改用公开编号文本后通过。记录失败，不将初次失败记作成功。

视觉检查已查看 solid-dark-1440.png、solid-light-1080.png：控件、实体尺寸相对关系、标签和选中浮层可读。八张图覆盖深浅主题、1440／1080 宽度、实体／分析线。真实鼠标点击圆截面及保存后分析来源不变见 [desktop.json](./desktop.json)。
