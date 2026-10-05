# T2-14 验证记录

日期：2026-10-05（Asia/Taipei）。Windows x64 开发机；原生构建使用 ADR-0046 的固定库及 MSVC，数值与 Electron 子进程仅保留 Windows System32 PATH。此条件不替代干净 Windows 安装实测。

| 检查 | 结果 |
| --- | --- |
| `npm run build:native` | 通过 |
| `npm run typecheck` 与 `npm run build` | 通过；Vite 保留已有大 chunk 提示 |
| `node scripts/verify-plan2-t214.mjs` | 22 独立算例／2,322 检查、7 异常模型、11 直接原生输入、2 边界算例均通过 |
| 定向 `native-static`、旧原生结果及任务接口单测 | 通过；4 个新增测试覆盖任意位置、图形、历史比较、报告、引用及非法映射 |
| `npm test` | 55 文件、427 测试通过 |
| `node scripts/run-e2e-isolated.cjs e2e/plan2-t2-14-native.spec.ts` | 1 测试通过：22 原生算例真实桌面运行、保存重开、过程核查、负组合 Word/PDF 导出、机构不保存成功结果、原正式计算入口回归 |

数值记录：[numerical-results.json](./numerical-results.json)；冻结 wire 与模型：[wire-samples.json](./wire-samples.json)；桌面记录：[desktop-results.json](./desktop-results.json)；截图：[native-process.png](./native-process.png)；实际导出：[Word](./native-combination.docx)、[PDF](./native-combination.pdf)。

原独立参考 SHA-256：`64c378ed7d7fc521f8a39fc38da2383715b4e6b77a25a771232b1a469cdac31b`。原参考 JSON、生成器与比较门槛均未修改。最大绝对误差分别为 m `1.115e-14`、rad `3.322e-15`、kN `2.885e-12`、kN·m `1.150e-11`；逐项误差／容差比最大 `0.011504`。旧新节点及杆端数值最大绝对差 `1.128e-11`（仅为回归对照，量纲与独立比较见逐项记录）。

先运行回归脚本时旧核心拒绝 native/2；新增能力实现后独立基准通过。报告单测发现 JSON 配置字段顺序误判并修复。一次验证脚本启动时构建尚未结束，Vite 文件 watcher 遇到锁定 obj；脚本关闭无必要的 watcher 后解决。桌面回放的前三次失败均为新增测试的 locator／对话关闭处理（status 匹配多个元素、Escape 不关闭计算书、两个关闭按钮）；限定 footer 与实际关闭按钮后通过，没有把失败记为产品通过证据。

复跑完整本任务通路：`npm run evidence:plan2:t214`。不重跑或改写旧安装候选，未执行真实 AI 新能力联测及完整 Electron 套件；本任务桌面场景通过不代表整轮验收。
