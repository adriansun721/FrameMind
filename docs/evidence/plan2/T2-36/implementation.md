# T2-36 实现与验收

日期：2026-10-07（Asia/Taipei）。已完成实现及确定性验证。

统一来源展示覆盖线性静力、弹性二阶、模态、特征值屈曲和随机 PSD／RMS。工具摘要、面板、冻结场景及引用保留同一分析身份、工况、输入修订、单位、求解器、完成／收敛与过期状态。图例区别实际变形、归一化形态和随机统计量，切换清理旧状态。支持矩阵继续拒绝无依据的因子、振型和 RMS 比较／叠加。

频率、屈曲因子、节点形态及原杆件沿杆样本提供真实 token 引用；静力／二阶沿杆位移与内力复用冻结恢复入口。已删除工程对象仍可核对冻结坐标和沿杆位置，并在冻结场景中定位，不重新加入正式模型。过程按需读取实际离散、参数、阶段、自由度、矩阵及加载迭代，缺失记录明确标注。随机矩阵使用其冻结模态来源，不借最新模态替换。

技术决定见 [ADR-0069](../../../decisions/0069-cross-analysis-result-inspection.md)。需求覆盖 US2-006、US2-053、US2-070、US2-071、US2-074—US2-077；承担 AC2-19、AC2-20 中的结果、来源、对象与过程核查部分。

| PLAN2.0 条目 | 证据 |
| --- | --- |
| 方法、工况、版本、单位、完成／过期统一；切换不串用 | verification.json 的五方法摘要；desktop.json 的 AC5→AC2→AC4→AC1→AC3→AC5 切换与对应图表／图例；historical-overlays.json 的随机工况激活下浏览静力／模态历史 |
| 工程对象与沿杆定位，内部身份拒绝 | result-inspection.test.ts 的原生样本／内部节点拒绝；沿杆实际位移表；第2阶形态工具回放；historical-desktop.json |
| 变形、特征形态、随机统计区分与禁止叠加 | 共享语义及能力矩阵；verification.json 的模态／屈曲／随机比较拒绝；归一化引用在 mm-N 下保持系数 |
| 原运行实际过程与缺失记录 | 各方法最多2项的实际过程分页；静力内部轮次矩阵、二阶实际迭代、随机冻结模态矩阵的精确一致；静力质量矩阵缺失桌面核查 |
| 共享输入、旧模态、删除对象与历史同源 | 几何修改使五种方法过期；重新提取模态后随机结果过期，原模态身份保留；删除原杆件、保存解码、冻结引用与原结果值完全一致 |

## 验证结果

- 类型检查与生产构建通过；已有的大包体积提示仍存在，本任务未改分包策略。
- 完整单元测试：85 个文件、658 项通过；新增跨分析公开入口专项 4 项通过。新增测试采用常规实现后验收流程，未采用 TDD。
- [verification.json](verification.json)：真实 C++ 五方法计算、来源、实际过程分页、冻结模态矩阵、沿杆位移／形态／RMS 本地引用一致、共享输入变化、旧模态、保存删除历史及禁止比较通过。没有改变数值算法，不重复宣称新增数值方法已独立验收。
- [desktop.json](desktop.json)、[historical-desktop.json](historical-desktop.json)、[historical-overlays.json](historical-overlays.json)：3 项 Electron 流程通过；覆盖来源切换、图表／图例清理、实际位移表定位、缺失记录、模态第2阶沿杆引用、mm-N 单位、浅色／深色 1080／1440、删除对象的冻结场景与正式模型隔离；AC5 随机工况激活下查看 AC3 静力自重及 AC2 模态历史，自重标签来自冻结来源，随机箭头／图例不串入。
- 可复核输入：[all-methods.framemind](all-methods.framemind)、[deleted-history.framemind](deleted-history.framemind)、[weighted-history.framemind](weighted-history.framemind)。截图 citation-*、deleted-citation.png 与 historical-overlays.png；视觉核查来源、引用与冻结场景可读。
- 双轴审查另见 [review.md](review.md)，提交基点为实施开始的 `2cb3954`。

复验命令：`npm run evidence:plan2:t236`。现有工作区其他任务的证据改动未纳入本任务提交。

## 限制与后续责任

AI 调用是确定性工具回放，realAi=false；真实模型联测属于 T2-41。目标规模内存／响应耗时尚未测量，属于 T2-42；不以本机小模型代替。完整计算书与数据导出属于 T2-37／T2-38，AC2-20 的实际导出验收仍需这些任务完成。
