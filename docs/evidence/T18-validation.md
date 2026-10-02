# T18 验收记录：整体求解过程与教材关联

日期：2026-10-02。平台：Windows / Electron / Three.js。实现基线：当前工作树的 T18 变更。

## 验收输入与入口

`e2e/t18-analysis-process.spec.ts` 通过真实 Electron 入口创建 N1=(0,0,0)、N2=(4,0,0) m，使用默认材料和箱形截面连接 M1，N1 固定，N2 施加 FX=8 kN，运行 LC1 后打开分析结果中的“整体求解过程”。

## 数值与来源核对

- `src/domain/analysis-t18.test.ts` 核对 12 个稳定自由度、约束索引 0—5、自由索引 6—11、成员整体索引映射、整体/约束后矩阵尺寸和冻结荷载向量；单杆情况下整体矩阵项与成员贡献逐项相等。
- 过程快照在求解完成时与结果一起绑定原分析 ID、模型修订号和求解器配置；旧项目没有快照时才使用冻结输入重建并标记来源。旧结果缺少求解器配置时拒绝直接重建，补算产生新的分析 ID 并保留原来源 ID。
- 超过 72 阶的模型不提供完整整体矩阵，保留节点自由度、约束状态和每根成员的 12×12 整体贡献，满足按索引定位与局部查看。

## 教材核查

教材引用数据同时记录印刷页和 PDF 页序，明确 PDF 前置页偏移。公式列将整体方程、坐标转换、单元刚度项、整体组装和荷载向量分别映射到对应章节页码。实现与教材差异包含坐标转换矩阵转置方向及零位移约束下的自由度消元方式，并分别记录原因和验证依据；没有将未核对内容标为公式编号。

## 桌面验收

`npx playwright test e2e/t18-analysis-process.spec.ts` 通过：面板显示自由度/约束/自由统计、整体组装入口、N1 稳定 ID、成员整体索引 0—11、书内印刷页和 PDF 页序。

## 验证命令

```powershell
npm run typecheck
npx vitest run src/domain/analysis-t18.test.ts src/domain/analysis-t17.test.ts src/domain/analysis-t04.test.ts
npm run build
npx playwright test e2e/t18-analysis-process.spec.ts
```

以上命令在本次验收中通过。完整测试和全量 Electron 回归在提交前运行；大模型只显示索引和局部成员贡献，不承诺保留完整消元轨迹。
