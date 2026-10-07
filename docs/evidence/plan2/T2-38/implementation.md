# T2-38 随机响应计算书与数据导出验收

日期：2026-10-07（Asia/Taipei）。规格：PLAN2.0 T2-38，US2-069—071、US2-078，AC2-20。设计契约见 [ADR-0071](../../../decisions/0071-random-response-report-and-data.md)。

## 实现

工程计算书现可选择随机响应分析，导出同源 Word/PDF。正文列冻结模型、源关系及空间作用、输入谱、模态基础、质量来源、阻尼、频段、实际频点与积分设置，绘制全部保存响应频点并列统计 RMS、方差、节点、分量、坐标／参考系及单位。历史结果保留原输入且标识过期；不补算过程，不将统计 RMS 称作峰值。

默认频点表最多 32 点，明确前后各 16 点、原索引、总点数及中间省略范围；完整频点附录可选。新增“导出随机数据 ZIP”始终保留全部输入谱与响应频点、原数字精度、完整冻结分析与模态基础、已有过程记录和缺失说明。CSV 同时提供内部及显示单位列，矩阵和归一化振型保留内部混合单位。矩阵随 ZIP 导出，不要求界面中不存在的单独矩阵选项。

导出开始前捕获来源。ZIP 经压缩、可信 IPC 验证、67.5 MB 大小预算及原子写入；超预算明确失败，不静默裁掉数据。Word 的 PSD 图继续复用 Worker 栅格化路径；不增加产品依赖或更改随机求解算法。

## 验证

- `npm run evidence:plan2:t238`：原生构建、五组真实求解样本、类型检查／打包、5 项随机报告公共入口测试和 Electron Word/PDF/ZIP 导出通过。
- `npm test -- --maxWorkers=2 --reporter=json --outputFile=docs/evidence/plan2/T2-38/unit-tests.json`：全量 87 文件、667/667 项通过。旧随机报告拒绝测试更新为冻结随机结果保留断言；完整长表测试核对 Word 与 PDF 的全部数字单元格。
- `node scripts/run-e2e-isolated.cjs e2e/plan2-t2-37-reports.spec.ts`：静力、组合、二阶、屈曲、模态和缺记录六组既有桌面报告回归通过。
- 五组样本每个完整 CSV 频点与原结果相同；显示 PSD／方差乘 10⁶、RMS 乘 10³，梯形积分复算 RMS 相对误差小于 10⁻¹²；RMS 工具引用绑定原分析与数值。见 [verification.json](verification.json)。
- 桌面 ZIP 的 `analysis.json` 与保存工程中的原分析逐字段一致；分页工具输出的全部 PSD 点、频率、单位与冻结结果一致。见 [desktop-source-check.json](desktop-source-check.json)。
- 五组两格式所有纯数字表格单元格与实际排版 PDF 文本一致，长表每格式核对 6,603 个不同数值；页面边界／空白页检查通过。见 [layout-check.json](layout-check.json) 和 [visual-check.json](visual-check.json)。
- 最后仅修正随机报告矩阵说明，重新 `npm run build` 并运行隔离 Electron 界面检查通过；深／浅主题 1080p、1440p 四张最终截图均复核，按钮和说明可见，无裁切。

## 同源样本与逐页复核

所有样本在完成分析后将当前节点从 x=3 m 改成 x=8 m，实际导出仍保留 x=3 m；均以 mm/N 显示，报告标识历史过期。原工程、内容块、完整数据 ZIP 与桌面成品按同名前缀保存。

| 样本 | 验证内容 | 响应点数 | Word 页数 | PDF 页数 |
| --- | --- | --- | --- | --- |
| force | 节点外力、固定全局参考、RMS 49.43848 mm | 1,313 | 12 | 9 |
| base | 基底加速度谱、相对基底参考、加速度密度平方单位 | 1,313 | 12 | 9 |
| multi | 基底与外力独立，节点／均布力同源，系数及单位 | 1,313 | 13 | 10 |
| long | 完整 2,193 响应点和 257 输入点，长表续页 | 2,193 | 110 | 83 |
| missing | 真实 192 方程模态基础，未采集 K/M 明确缺失 | 1,601 | 13 | 9 |

总计 160 页原生 Word、120 页产品 PDF，共 280 页。全部最终页面 PNG 逐页原尺寸检查完成，未见重叠、裁切、错误续表表头、乱码、缺失单位或空白尾页。长 Word 收敛尾段与下一节共享页面，矩阵单位说明放在可选附录之前，消除独立尾句页。Word 由隔离只读 COM 转成 PDF 后，和产品 PDF 一起复用 documents `render_docx.py` 的栅格化入口；本机缺少 LibreOffice，不影响使用原生 Word 验证排版。

最终成品 SHA-256 与逐页范围保存在 [visual-check.json](visual-check.json)，双轴代码审查见 [review.md](review.md)。页面 PNG 和联系表位于忽略目录 `.scratch/T2-38-layout`，可按以下命令复现；工程／成品及验收 JSON 已入库。

```powershell
npm run evidence:plan2:t238
python scripts/render-plan2-t238.py --renderer C:/Users/小红薯/.codex/plugins/cache/openai-primary-runtime/documents/26.905.11957/skills/documents/render_docx.py
```

本任务是确定性导出及一致性验收，真实 AI、跨方法独立数值基准、目标规模性能分别由 T2-41、T2-40、T2-42 承接。
