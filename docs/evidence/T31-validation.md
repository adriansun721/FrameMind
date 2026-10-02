# T31 验收记录：独立数值基准与正确性

日期：2026-10-02。平台：Windows x64 / Node 24.19.0。实施基线：`f2820be`。需求：PLAN.md T31、PRD US-056、AC-08、AC-11、AC-12。用户确认三个公开分析入口及开发前审查基线。

## 独立参考与复现

- [预登记依据、单位、容差与教材疑点](../decisions/0032-t31-independent-numerical-benchmarks.md)
- [连续虚功/力法参考生成程序](../../scripts/generate-t31-references.py)
- [完整固定输入与独立参考](../../src/validation/t31-references.json)
- [实际输入、结果、逐项误差与失败定位 JSON](T31-numerical-results.json)

```powershell
npm run evidence:t31
npx vitest run src/validation/numerical-benchmarks.test.ts
```

上述命令离线运行，使用产品 `solveFrame`、`getMemberSectionForces`、`getOverallAnalysisProcessRecord`，没有 AI、外部求解器或网络依赖。报告逐次覆盖固定路径，失败返回非零退出码并保留算例和数值项位置。报告带参考 SHA-256、运行代码提交、平台、求解器版本及实际冻结输入。

参考重建：`python scripts/generate-t31-references.py`，开发验收需 Python/SymPy；产品及日常复跑不依赖 Python。重新生成的参考与已登记文件逐字节一致。参考生成不读取或导入产品实现，只使用截面平衡、单位荷载积分和六冗余量的连续力法。

## 数值覆盖

| 算例 ID | 独立参考/验证内容 |
| --- | --- |
| axial / bend-y / bend-z / torsion / moment-y / moment-z | 六种单独节点端荷载，全部零分量也比较 |
| six-components | 节点力和力矩共同作用 |
| vertical / skew-rotated-section | 竖直与偏斜杆，已登记局部轴及 90° 各向异性截面 |
| uniform-local / uniform-global-skew | 局部/全局三分量连续均布力及沿杆截面 |
| self-weight | 密度×面积×重力的实际分布力 |
| case-LC1 / case-LC2 | 同一多工况项目分别选择 LC1/LC2，LC2 包含均布力及自重 |
| combination-negative / combination-zero | 1.5LC1−0.5LC2 与零系数组合，独立登记加权实际荷载 |
| fixed-fixed-uniform | 两根杆共同节点、两端固定的均布梁 |
| spatial-chain | ADR-0004 静定三杆空间折线的独立再现 |
| closed-spatial | 六根空间闭环杆、一个固定节点、六冗余力法兼容 |
| textbook-2-1 / textbook-2-1-condensed | 教材例 2-1 的原图荷载与书中等效节点荷载，作为两个独立模型 |

21 个有效算例全部通过，共 2,196 项检查：节点平移/转角各 159 项，力与力矩各 939 项（包含两端内力、三处截面、六分量平衡和实际过程一致性）。所有对象按冻结输入的稳定 ID 查询。m/rad 绝对容差 `1e-11`，kN/kN·m `1e-9`，相对容差 `1e-8`；整体平衡仅用绝对容差。近零量不报告虚假的相对误差。

| 量纲 | 最大绝对误差 | 最大误差/该项容差 |
| --- | --- | --- |
| m | 1.284×10^-16 | 5.473×10^-6 |
| rad | 4.771×10^-17 | 1.804×10^-6 |
| kN | 4.547×10^-13 | 4.548×10^-4 |
| kN·m | 1.535×10^-12 | 1.535×10^-3 |

全部算例的整体外力平衡最大残差为 `3.731×10^-13 kN`，关于原点的力矩平衡最大残差为 `1.535×10^-12 kN·m`。外力累加使用独立登记的真实荷载合力/作用点，不使用产品等效节点力替代。真实过程另核对来源 ID、运行快照、自由度映射、`K*u-F=R` 和等效荷载的外力合量；这些过程检查未充当独立求解参考。

## 无效与不稳定输入

7 个算例均从 `solveFrame` 拒绝且保留原输入：missing-parameter、zero-length、invalid-reference、isolated-node、disconnected-unrestrained、no-support、rotational-mechanism。前六项定位模型检查阶段、对应代码与对象，适用时核对字段；机构算例定位求解阶段、节点自由度、主元与阈值证据。不会返回标记为完成的结果。每项报告保存实际无效输入和诊断，能确定性复现。

## 教材复核

逐页核查教材印刷 42–46 页 / PDF 51–55 页。图 2-12 的 +18 kN·m 方向通过高分辨率箭头确认，初次转录修正不涉及产品算法或容差。原图分为四杆五节点，把杆中集中荷载放到新增节点上，符合首版能力。

第 43 页的等效 FA 以及第 44 页的 y–θ 刚度耦合存在可复核疑点；书中位移不作为本任务高精度参考。ADR-0032 记录单位换算、三个结果组及应有的梁端方向耦合。连续力法与产品刚度法在原图模型、等效荷载模型两者上分别一致，未为迎合印刷结果更改求解器。课本矩阵与位移的历史显示依据继续保留来源，首版理论边界没有扩大。

## 回归与审查

专项 22/22 通过，类型检查和生产构建通过。完整单元测试 38 文件/266 项通过。第一轮桌面回归 71/72，相机缩放阻尼用例超时；单独复跑三次，首项超时、后两项通过。追踪中帧回调约一秒一次，说明失败运行存在帧调度减慢，未修改不属于 T31 的视口代码。第二轮完整回归与两路审查结果在完成后补记。

回归前备份全部既有证据，结束后逐字节恢复并验证 160 份文件，包括用户已有截图修改。本任务不纳入用户的 PLAN-UI.md 删除、原有截图差异和教材 PDF。
