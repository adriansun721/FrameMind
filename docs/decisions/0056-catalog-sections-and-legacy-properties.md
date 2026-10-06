# ADR-0056：标准截面目录依据与旧属性截面

日期：2026-10-06（Asia/Taipei）。状态：接受。范围：PLAN2.0 T2-23，US2-045/046，AC2-14/23 的截面子集。

## 原始资料

首批仍为 IPE 100、IPE 200、HEA 200（原表名称 HE 200 A）。于本日下载并核查 [ArcelorMittal Sections and Merchant Bars V2026-1](https://sections.arcelormittal.com/repo/Sections/Sections%20and%20Merchant%20Bars-ArcelorMittal_V2026-1.xlsx)，工作表 EN sections 的 C1 为 2026-1，三个数据行分别为 70、54、174。原表 h/b/tw/tf/r 位于 G/H/I/J/K，单位 mm；A 位于 N，单位 cm²；Iy/Iz/It 位于 AD/AI/AN，单位 cm⁴。It 对应本项目 Saint-Venant J；不包含 Iw 翘曲刚度。原文列值、位置及下载内容 SHA-256 见 [目录核查摘录](../evidence/plan2/T2-23/catalog-source.json)。三个原有 A/I/J 数值无需修订。

## 保存与计算

`SectionProperties.catalogBasis` 保存目录编号、原始名称、完整来源、行列位置、圆角 r、参考几何和参考 A/I/J，同时归档仅供对照的 `idealizedComparison` 数值、公式版本及 URL、简化说明和适用性标记。顶层几何为忽略圆角的双对称 I/H 示意；顶层 A/I/J 为**正式求解使用的目录值**。领域校验保证顶层几何及参数与归档行一致，拒绝只修改顶层数据而保留目录声明。明确转为属性模式或理想化尺寸模式后移除目录依据，原目录保留在 provenance.derivedFrom。

与 ADR-0055 的理想化参数截面分开：`parameterBasis` 只用于理想化正式分析；目录模式没有该字段。`idealizedCatalogComparison` 用同一尺寸计算独立显示的理想化 A/I/J，并明确公式来源、忽略圆角、交汇及目录舍入的影响，不向求解器替换目录值。IPE 100 的 tf/b=5.7/55 略超出 0.1 门槛，因此目录可正常使用，理想化 J 只作公式对照。物理尺寸验证和正式薄壁公式适用性验证各自明确；T2-22 正式尺寸计算的限制没有放宽。

已保存项目及冻结结果读取其归档行和归档理想化对照，**不依赖当前安装目录或当前公式重新生成历史对照**。目录以后变化不能静默改写已有对象。资源库导入、材料截面创建对话框、参数截面管理及 Agent 工具都复制完整依据，纯建模与整体任务确认入口均通过完整截面契约保留归档字段。`read_section_contract` 提供首批目录；`propose_model_edits` 的 create/update_section 接受 `{name,catalogId}`，归一化后经过同一整体预览与确认。读取对象提供 geometryStatus 和 idealizedComparison；归档 catalogBasis 保持规范单位 m/m²/m⁴，当前显示的几何及力学数据按单位预设转换。

## 旧项目及人工控制

旧 v1/v2 属性截面没有 geometry 时保留实际 A/I/J 和既有来源；即使名称或数值匹配目录也不补几何。对象预览、Agent、视图选中信息及计算书明确“几何未定义”。本阶段三维模型继续用分析线，真实实体切换由 T2-24 负责。

补充几何或改用目录需要用户主动选择模式，核对全部共享引用杆件、正式分析值及几何简化后再次确认。改草案或工程状态后旧确认不可应用。一次确认形成可整组撤销的事务；刚度或面积改变使依赖结果过期，原始静力结果与输入保留。仅增加来源不会改变工程量。

## 验证门槛

原表所有三个数据行的尺寸及 A/I/J 独立字面值在领域测试核对（尺寸绝对容差 1e-14 m，仅消除 mm 除法的浮点表示差异；力学数据为原目录 SI 转换值）。原生悬臂采用 ADR-0055 的 FL/EA、PL³/3EI、TL/GJ 和旋转柔度参考，三个目录 × 0/90/30°，响应与平衡采用 max(1e-12, |参考|×1e-9)。另用与目录不同的同名旧属性截面验证 v1 迁移、历史输入、原生求解和主动补充后的依赖过期。

保存重开、待确认草案恢复、共享资源库、Agent 单位读取、Word XML 与 PDF 打印内容均检查来源和缺失标记。专项 Electron 测试验证真实窗口交互及跨进程恢复；确定性工具回放不等于 T2-41 真实 AI 联测，旧项目本机测试不等于 T2-44 干净 Windows 安装验收。
