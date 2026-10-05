# T2-17 验证记录

日期：2026-10-05（Asia/Taipei）。

- `npm run typecheck`：通过。
- `npm run build:native`、`npm run build`：通过；保留已有大型 bundle 提示。
- `npm test`：59 文件／468 测试通过。
- `node scripts/run-e2e-isolated.cjs e2e/plan2-t2-17-units.spec.ts`：1 项真实 Electron／C++ 桌面流程通过。
- 核对导出 Word 的 OOXML 单位、数值及图像；PDF 4 页，文本抽取核对 MPa、mm²、N、N·mm、16000 N 和 0.032 mm；已渲染检查第 3 页，无数值／单位错配或表格截断。
- 深／浅主题及 1440／1080 宽度截图已检查，单位预设可访问。

数值参考：轴向杆 E=200 GPa、A=.01 m²，L=2 m／F=8 kN 的单元测试独立值 ux=8e-6 m=.008 mm；L=4 m 的桌面原生算例 8 kN→.016 mm，16 kN→.032 mm。原生结果输入、来源和旧历史保持规范数值。

补充回归：旧版单个／批量平铺坐标工具、同步／异步诊断单位边界、比较端力差值及单杆自重、工况响应表、建模卡片单位标签、单位偏好跨模型撤销／重做。

完整测试与构建首次并行时，两项大型报告测试超过默认 5 秒限时；单独重跑完整测试，59 文件／468 测试全部通过，未修改限时。

验证中修复：Word 图像预生成与 Worker 未共享显示偏好，导致图表来源匹配失败；现已把偏好纳入导出开始时的冻结资料。撤销路径仅在偏好确实不同时复制对象，保留旧无变化返回身份契约。

详细结果见 [desktop-verification.json](./desktop-verification.json)、[项目样本](./units.framemind)、[Word](./units.docx)、[PDF](./units.pdf)。复跑入口：`npm run evidence:plan2:t217`。

未执行真实 AI 新单位能力联测、动态分析谱输入／输出、干净 Windows 或整轮综合验收。
