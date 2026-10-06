# T2-26 验证

日期：2026-10-06（Asia/Taipei），本机 Windows x64。方法、阈值和资源预算预登记于 [ADR-0059](../../../decisions/0059-internal-mesh-and-static-convergence.md)。

- `npm run build:native`、`npm run typecheck`、`npm run build` 通过；Vite 保留既有大 chunk 提示。
- `npm test -- --maxWorkers=2`：74 个测试文件、571 个测试通过。限制并发用于避免同时运行报告导出与桌面测试时的资源争用，没有放宽测试超时。
- `node scripts/verify-plan2-t226.mjs`：35 个真实原生案例、1647 项解析／平衡／残差检查、2 项结构化失败验证通过。全部 16 种端部释放组合，轴向、框架、旋转轴、自重与正负组合均覆盖；局部轴参考临界角两侧在四种坐标偏移下逐轮验证工程荷载合量、完整轴组及解析中点挠度。
- 单网格、方程预算、极严精度均返回明确未收敛；初始网格超预算和真实机构返回失败。篡改映射、继承输入、内部轴、响应、规模和收敛声明被拒绝。
- T2-26、T2-25 专项 Electron 复测 4 项全部通过，验证工程拓扑和选择不增加内部节点，规模可见，策略保存和结果重开一致，未收敛提示明确，以及释放编辑／确定性工具确认。T2-14 结果视图另已执行一次定向回归。
- 实际 Word／PDF 导出覆盖正文规模与误差记录、选中工程杆对应的内部组装附录；检查分析身份、方程数、内部单元及缺失记录。PDF 首末页、杆件过程页及组装页渲染检查通过，无截断；保留 mesh.docx／mesh.pdf 与浅深色 1080／1440 截图。

数值明细见 [numerical-results.json](numerical-results.json)，原生保存样本见 [wire-samples.json](wire-samples.json)，桌面结果见 [desktop.json](desktop.json)，审查闭环见 [review.md](review.md)。可用 `npm run evidence:plan2:t226` 重建专项证据。

此验证只闭合 T2-26 的静力细分任务。真实 AI 联测、典型目标规模性能、模态／屈曲／二阶收敛及干净 Windows 安装由后续任务承接，未以本地确定性测试宣称这些验收完成。
