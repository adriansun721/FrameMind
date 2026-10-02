# T17 验收记录：杆件真实计算过程

日期：2026-10-02。平台：Windows / Electron / Three.js。实现基线：当前工作树的 T17 变更。

## 验收输入与入口

`e2e/t17-member-process.spec.ts` 通过真实 Electron 入口创建 N1=(0,0,0)、N2=(4,0,0) m，使用默认 Q355 和箱形截面，M1 连接两节点，N1 固定，N2 施加 FX=8 kN；运行 LC1 后从项目树选择 M1，在杆件属性面板查看过程。

## 数值和来源核对

- `src/domain/analysis-t17.test.ts` 从公开建模操作和 `solveFrame` 构造输入，读取 `getMemberAnalysisRecord`。记录绑定分析 ID、项目修订号、M1 的 12 个自由度、局部轴、12×12 局部/整体矩阵、转换矩阵、位移和杆端力；轴向刚度首项 `EA/L=500000 kN/m`、起点到终点转换及终点轴力 8 kN 均通过独立常数核对。
- 旧结果删除求解器配置后，原记录入口明确拒绝重建；`supplementMemberAnalysisRecord` 调用当前求解器产生不同的分析 ID，并保留原来源分析 ID，标记为 `supplemental-reconstruction`。
- 面板默认显示局部轴、自由度映射、位移/转角、等效荷载及端力；局部刚度、转换和整体刚度矩阵需要逐个展开，行列标题包含节点稳定 ID、自由度和整体索引，数值保持冻结输入的单位基础。

## 教材核查

项目中的扫描版《计算结构力学》渲染页脚核对书内印刷页：5.2 节转换矩阵及式 (5-28)—(5-30) 在印刷页 126 附近，5.3 节单元局部刚度式 (5-14)—(5-27) 在印刷页 122—125，5.4—5.5 的自由度对号与总刚度集合在印刷页 127，5.6 荷载向量线索在印刷页 129，附录 IV 的程序组织线索在印刷页 180。PDF 页序不作为展示页码。

教材的 `[T]` 与实现存储方向相反：教材按总体到局部的转置记法展开，而实现将局部轴作为矩阵行，故面板显示 `u_local = T·u_global` 和 `K_global = Tᵀ·K_local·T`。这是正交矩阵的转置表示，已用空间轴及局部矩阵数值对照；没有把未核对的内容标成公式编号。

## 桌面验收

`e2e/t17-member-process.spec.ts` 通过：过程面板显示来源分析 ID、局部 x/y/z、N1/N2 稳定 ID、`u_local = T · u_global`、教材第 5 章依据；展开局部刚度矩阵后可见 12×12 表格及 `500000` 轴向刚度项。截图见 [T17-member-process.png](T17-member-process.png)。

## 验证命令

```powershell
npm run typecheck
npx vitest run src/domain/analysis-t17.test.ts src/domain/analysis-t04.test.ts src/domain/analysis-t09.test.ts
npm run build
npx playwright test e2e/t17-member-process.spec.ts
```

以上命令在本次验收中通过。完整测试和全量 Electron 回归在提交前运行；当前过程记录按需重建，不承诺保存完整消元轨迹或 T18 的整体组装过程。
