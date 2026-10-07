# T2-37 稳定性与模态计算书验收

日期：2026-10-07（Asia/Taipei）。规格：PLAN2.0 T2-37，US2-058、US2-075、US2-078，AC2-20。设计契约见 [ADR-0070](../../../decisions/0070-stability-and-modal-reports.md)。

## 实现

工程计算书保留静力正文及可选过程附录，新增初应力弹性二阶、特征值屈曲与模态的 Word/PDF 输出。两种格式消费同一冻结 ReportBlock，正文使用所选分析原输入与结果，显示工程对象 ID、分析身份、工况、修订、完成／收敛状态、当前有效性、求解器及单位。导出异步操作之前捕获来源；当前几何、荷载和设置的后续编辑不能替换报告条件。

二阶报告展示实际设置、加载校正、网格比较与同次运行线性基准，以及完整节点位移、反力、杆端力。屈曲明确固定荷载不随 λ 放大，分别输出固定／参考工况、原荷载、等效荷载、自重及因子。模态展示结构、节点附加、线附加质量与总质量，列频率、特征值、残差、正交误差、零能模态、收敛与归一化形态。

特征形态使用原记录的沿杆样本绘图，虚线为冻结分析线，每阶单独缩放，明确幅值不代表实际受载位移。特征方法不套用静力结果槽，报告不生成安全、承载力或规范合格结论。

新增可选附录按方法限定设置、内部细分、计算坐标、K/M/G、加载校正、完整形态和预应力等分量。只引用所选运行实际记录；矩阵超过原 144 阶采集门槛时明确缺失，不构造零矩阵或隐藏重算。矩阵／校正向量自动附带坐标到工程对象映射，矩阵每六列分块，保留内部混合单位。高级分析的补算入口在界面与公共 API 均拒绝；静力原有显式补算契约保留。

Word 表格间加入小间距段落，防止相邻表格被原生 Word 合并并错误重复首表表头。正文使用 keepLines，最后表格后定义小行高必需段落，避免孤立尾句和空白尾页。

## 验证

- TDD 使用 ADR-0031 已确认的报告公共入口及 Word/Electron 出口边界。旧模态拒绝测试先失败，再开放冻结模态报告；Word 连续表回归在修复前两项失败，覆盖普通与大模型序列化分支。
- `npm run build`：类型检查、Electron 主进程及 Vite 打包通过；保留既有大块体积提示。
- `npx vitest run src/workspace/report-word.test.ts src/workspace/stability-report.test.ts src/workspace/report-pdf.test.ts --maxWorkers=2`：14 项通过。
- `npm test -- --maxWorkers=2`：全量 86 文件、662 项通过。
- `node scripts/verify-plan2-t237.mjs`：原生求解生成六组冻结工程，全部数值／来源检查通过，详见 [verification.json](verification.json)。`--reuse-fixtures` 可从已保存样本重新生成内容检查，不改变分析身份或重新求解。
- `node scripts/run-e2e-isolated.cjs e2e/plan2-t2-37-reports.spec.ts`：真实 Electron Desktop 六组 Word/PDF 输出通过，历史状态与实际附录正确，导出后仍只有一个窗口。
- Word 使用隔离只读 COM 排版后转 PDF；产品 PDF 和 Word 排版 PDF 使用 documents 的 `render_docx.py` 栅格化，每页原尺寸检查。自动核对两种格式正文与所有 OOXML 表格单元格、页边界和字体；生成时间允许独立导出的时间差，跨页页脚不参与内容比较。
- 深／浅主题 1080p、1440p 四张工程计算书对话框截图完成检查，内容及操作可见，无裁切。

## 同源样本

六组样本均在分析完成后修改当前几何，报告仍使用原几何且标识历史过期。原工程、内容块和成品按同名前缀保存，可直接逐项复核。

| 样本 | 关键对照 | PDF 页数 | Word 页数 |
| --- | --- | --- | --- |
| static | 原节点轴向位移 0.00002 m，静力附录 | 6 | 6 |
| combination | 原系数 −0.5，等效横载 1.5 kN，自重 4.62051 kN | 6 | 8 |
| second-order | 同次线性基准及实际校正，末节点横移 0.0003027382 m | 15 | 20 |
| buckling | 固定 30 kN／参考 10 kN，首因子 88.38524 | 21 | 27 |
| modal | 结构 471 kg + 点 100 kg + 线 150 kg = 721 kg，首频率 6.139975 Hz | 11 | 12 |
| missing | 1533.549 kg，方程超过 144，预算未收敛与质量矩阵缺失均明确标注 | 9 | 12 |

共 68 页产品 PDF、85 页原生 Word 排版，153 页全部完成逐页视觉核查。无正文／单元格文本缺失、页面越界、错误续表表头或空白尾页。命名字体均嵌入；PDF 中无字体名的 Type3 数学字形直接保存在 PDF 图形资源中，已逐页确认正确显示。

最终页面检查见 [layout-check.json](layout-check.json) 与 [visual-check.json](visual-check.json)，代码双轴审查见 [review.md](review.md)。每组 `*-content.json` 是公共入口的完整附录内容对照；桌面实际导出按复验用途选择附录分量，不要求把所有矩阵全部勾选。

复验命令：

```powershell
npm run evidence:plan2:t237
python scripts/verify-t30-layout.py --renderer C:/Users/小红薯/.codex/plugins/cache/openai-primary-runtime/documents/26.905.11957/skills/documents/render_docx.py --source-dir docs/evidence/plan2/T2-37 --prefix= --overview-dir docs/evidence/plan2/T2-37 --samples static combination second-order buckling modal missing --output-dir .scratch/T2-37-layout-final
```

本任务未修改数值求解算法。随机响应计算书为 T2-38，跨方法数值基准为 T2-40，真实 AI 联测为 T2-41，目标规模成本为 T2-42。
