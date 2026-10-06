# T2-31 验证

日期：2026-10-06（Asia/Taipei）。所有数值通过门槛预先登记于 ADR-0064；原始结果见 [numerics.json](numerics.json)。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 原生编译 | `npm run build:native` | 通过 |
| 类型检查 | `npm run typecheck` | 通过 |
| 生产构建 | `npm run build` | 通过；既有 Vite 大包提示 |
| 最终完整单元测试 | `npm test -- --maxWorkers=2` | 78 文件／594 测试通过 |
| 二阶独立数值与保存证据 | `node scripts/verify-plan2-t231.mjs` | 17 算例／28 检查／13 失败检查通过 |
| 共用初应力代码屈曲回归 | `node scripts/verify-plan2-t230.mjs` | 11 原生算例／64 检查通过 |
| 桌面回归 | `node scripts/run-e2e-isolated.cjs e2e/plan2-t2-31-second-order.spec.ts e2e/plan2-t2-30-buckling.spec.ts e2e/plan2-t2-26-mesh.spec.ts e2e/plan2-t2-25-releases.spec.ts e2e/plan2-t2-16-analysis-cases.spec.ts` | 9 测试通过 |
| 双轴审查 | Standards／Spec 独立审查并分别复核 | 所有发现关闭，见 [review.md](review.md) |

首次完整单元运行与原生编译并行时，两项既有大型计算书测试触及 5 秒超时；串行运行测试并限制两个 worker 后，全部通过。未放宽测试超时或数值门槛。最终数值脚本并行回归产生一次 Vite 辅助 WebSocket 端口占用提示，计算与所有断言通过。

独立参考包括零轴力、200／500 kN 压力与 500 kN 拉力悬臂连续解，核查顶端位移、根部弯矩、水平反力及细分收敛；独立 RK4 连续边值求解核查变轴力、自重与均布横力；两柱铰接顶梁框架核查端释放、全局反力与映射。另覆盖旋转杆、实际输入组合、一步／四步加载一致性、固定轴力下横力缩放、整荷载缩放不能线性叠加、质量对当前性的影响、工具配置与读取及不同修订同输入比较。

失败覆盖每步一轮上限、切线失稳、小位移范围超限、单网格未收敛及方程预算不足；保存验证拒绝伪造零校正、残差、线性荷载、几何矩阵、响应与细分误差。单柱与 25 根独立柱覆盖未被纯轴向响应激发的失稳，后一算例覆盖 150／300 坐标且整体矩阵为 `null` 的分支。

桌面测试覆盖手动工况、真实 `/7` 运行、同条件线性曲线与数值、实际加载过程、1080／1440 双主题、保存重开和失败保留成功历史。截图已人工检查：[浅色 1080](second-order-light-1080.png)、[浅色 1440](second-order-light-1440.png)、[深色 1080](second-order-dark-1080.png)、[深色 1440](second-order-dark-1440.png)。

这些验证支持 ADR 中的初应力近似范围；未完成通用几何非线性、二阶计算书、真实在线 AI、目标规模性能或安装验收。
