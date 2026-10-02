# T33 双主题完整演示与首次使用验收

日期：2026-10-03（Asia/Taipei）。**技术验收已通过；真人首次试用未执行，AC-20 待验收，T33 未全部完成。**

## 固定输入与交付

算例为 [t33-demo.json](../fixtures/t33-demo.json)，范围与验收规则见 [ADR-0034](../decisions/0034-t33-complete-demo.md)。两层 6×4 m 正交空间刚架，每层 3 m，12 节点、8 柱、8 梁；采用 T13 S355JR、HEA 200 和 IPE 200。底层四节点六自由度固定，恒载为自重；外荷载包括屋面 5 kN 水平节点力和一根屋面梁 -2 kN/m 全局竖向均布力。用户组合为恒载×1 + 外荷载×1.5。所有演示值均非规范设计建议。

M1、M2 为唯一修改目标，新自定义截面四项参数为原 HEA 200 的两倍。两个确认阶段前保存并检查隔离，确认后真实 Worker 求解；读取 N10 全局 x 位移、N1 全局 z 反力、M1 起点 N 杆端内力；选柱确认后重算并逐项检查同一对分析的引用和差值，再选后次分析导出含 M1 过程及整体约束向量的 Word/PDF，保存重开。

空对话现在有起步说明、填写任务草稿和连接设置入口；模板不会覆盖已有草稿，也不会自行发送或应用模型。修复预览截面身份进入正式模型的缺陷；原共享资源与前次冻结结果保留。

## 运行证据

| 运行 | 最新完整记录 | 前 / 后项目与双格式计算书 |
| --- | --- | --- |
| 固定回放，深色 | [validation.json](T33/replay-dark/validation.json) | [前](T33/replay-dark/before.framemind)、[后](T33/replay-dark/after.framemind)、[Word](T33/replay-dark/计算书.docx)、[PDF](T33/replay-dark/计算书.pdf) |
| 固定回放，浅色 | [validation.json](T33/replay-light/validation.json) | [前](T33/replay-light/before.framemind)、[后](T33/replay-light/after.framemind)、[Word](T33/replay-light/计算书.docx)、[PDF](T33/replay-light/计算书.pdf) |
| 真实在线，深色 | [validation.json](T33/online-dark/validation.json) | [前](T33/online-dark/before.framemind)、[后](T33/online-dark/after.framemind)、[Word](T33/online-dark/计算书.docx)、[PDF](T33/online-dark/计算书.pdf) |
| 真实在线，浅色 | [validation.json](T33/online-light/validation.json) | [前](T33/online-light/before.framemind)、[后](T33/online-light/after.framemind)、[Word](T33/online-light/计算书.docx)、[PDF](T33/online-light/计算书.pdf) |

回放只替代 HTTP 工具响应；在线不替换 fetch，真实访问 DeepSeek HTTPS，使用本机已有 Windows 加密配置及隔离临时用户目录。在线模型为 `deepseek-flash`。环境为 Windows 10.0.26200、x64、Electron 44.5.1、Chromium 152.0.7977.130；精确运行版本、开始/结束时间、输入和构建哈希在各记录中。凭据不进入证据、项目和报告。

每份完整记录包含所有用户/确认消息、工具输入输出、已渲染引用、两次总反力检查和完整验证项目。只以 `outcome:passed` 及匹配文件哈希的当前运行作为通过依据；历史 failure 文件属于开发迭代，不能覆盖或替代本次结论。

## 核验结果与边界

- 两种主题、1440×900 与 1080×680：检查对象、虚线建模预览、半透明条件预览、自重/节点/均布作用、对象选择、变形和内力图例、引用详情、比较与报告对话框及失败提示；未发现影响辨认的主题缺陷。阶段 PNG 位于对应运行目录。滚动区域保持在窗口内，长卡片通过自身滚动核对。
- 两次计算的独立总体力平衡均通过预登记 1e-7 kN 绝对阈值：Rx=-7.5 kN、Ry=0，Rz=ρgΣAL/1000+18 kN；计算使用全部实际杆长和面积。此检查补充演示一致性，不替代 T31 数值基准。
- 三个指定事实/差值均检查实际可点击按钮和保存项目的冻结分析 ID、分量、数值及来源。确认前无正式修改；仅选柱分配新截面；前次结果保持；重开后保留两份结果，对话清空。故障回放保留已确认模型和结果，本地计算入口可用。
- 四组导出样本的 PDF 每份 16 页、Word 原生渲染每份 22 页；正文和所选过程附录同源，分页可不同。[layout-results.json](T33/layout-results.json) 核对正文段落、指定后次分析 ID、所有页面文字边界及源文件哈希；页面概览位于各目录的 `pdf-pages.png` / `word-pages.png`。开发 QA 使用 Word COM、Python 和 document renderer，产品导出不依赖这些工具。
- 验证：生产构建与双端类型检查通过；全量 38 文件 / 273 单元测试通过；全量 75 桌面测试通过。验收脚本与取证规则随后修正，仅重跑受影响的 T33 双主题与在线流程。

## 开发迭代与审查

完整演示先复现了预览 ID 覆盖正式截面身份，导致 Word 导出报“稳定标识格式无效”。`section-stage.test.ts` 增加确认后项目往返检查，修复前失败、修复后通过；另覆盖新增目录截面。正式身份由创建函数分配，材料/截面参数校验不再返回身份字段。

真实 DeepSeek 试跑曾遗漏 LC1 命名、改变组合或截面名称、将屋面 N10 猜为 N12、把屋面水平力分配到 N9，以及生成无法核对的引用。名称通过自然语言补充或卡片修正并记录；确认前核对荷载对象选择器与固定演示坐标，错目标通过卡片纠正并记录原/新身份。解释中的错对象由固定事实检查拒绝，随后明确稳定标识。无法核对的引用由应用拒绝，已确认模型和结果仍保留。完整在线通过表示在记录中的核对/确认/补充流程下可完成，不能承诺每次随机回复无误，也不代表所有 AI 原因推断被证明正确。自动解释失败如有发生会单独记录，最终三项比较仍必须实际核对成功。

code-review 审查基线为 `9232d605194c9964e729f7614c1147e3716f6930`；用户原有修改未纳入任务提交。两轴由独立审查代理复核，修复后再次检查，无未解决的代码审查问题；真人验收仍按下节保留。

### Standards

未发现 ADR 硬性违规。故障取证可能掩盖原异常的可靠性问题已修复，复核通过。

### Spec

发现引用未逐项验证可见按钮、旧成功证据混入重跑、自动解释状态采集过早，均已修复并复验。

## 复跑与真人验收

```powershell
npm run evidence:t33
npm run evidence:t33:online
python scripts/verify-t33-layout.py --renderer <documents技能目录下的render_docx.py>
```

先配置本机 DeepSeek，再运行在线命令；脚本只复用已加密配置，不向终端输出密钥。每次运行会使前次同模式/主题的通过状态失效，只有新一轮完整通过才能再次用于报告 QA。

[T33-first-use.md](T33-first-use.md) 提供给真实参与者的任务及独立观察记录。尚无真实参与者执行记录，不能勾选 PLAN 最后一项、不能声称 AC-20 通过，T34 仍受 T33 完整验收阻塞。
