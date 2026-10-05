# T2-14 验证记录

日期：2026-10-05（Asia/Taipei）。Windows x64 开发机；原生构建使用 ADR-0046 的固定库及 MSVC，数值与 Electron 子进程仅保留 Windows System32 PATH。此条件不替代干净 Windows 安装实测。

| 检查 | 结果 |
| --- | --- |
| `npm run build:native` | 通过 |
| 旧 native/1 请求直接复跑 | 9 个原生单杆结果与原保存证据一致；按项目 JSON 规则统一正／负零，未改写旧证据 |
| `npm run typecheck` 与 `npm run build` | 通过；Vite 保留已有大 chunk 提示 |
| `node scripts/verify-plan2-t214.mjs` | 22 独立算例／2,322 检查、7 异常模型、13 直接原生输入、2 边界算例均通过 |
| 定向 `native-static`、旧原生结果及任务接口单测 | 通过；5 个新增测试覆盖任意位置、图形、历史比较、报告、引用、非法映射及原生组合诊断的 IPC 传递 |
| `npm test` | 55 文件、428 测试通过 |
| `node scripts/run-e2e-isolated.cjs e2e/plan2-t2-14-native.spec.ts` | 1 测试通过：22 原生算例真实桌面运行、保存重开、过程核查、负组合 Word/PDF 导出、机构不保存成功结果、原正式计算入口回归 |

数值记录：[numerical-results.json](./numerical-results.json)；冻结 wire 与模型：[wire-samples.json](./wire-samples.json)；桌面记录：[desktop-results.json](./desktop-results.json)；截图：[native-process.png](./native-process.png)；实际导出：[Word](./native-combination.docx)、[PDF](./native-combination.pdf)。

原独立参考 SHA-256：`64c378ed7d7fc521f8a39fc38da2383715b4e6b77a25a771232b1a469cdac31b`。原参考 JSON、生成器与比较门槛均未修改。最大绝对误差分别为 m `1.115e-14`、rad `3.322e-15`、kN `2.885e-12`、kN·m `1.150e-11`；逐项误差／容差比最大 `0.011504`。旧新节点及杆端数值最大绝对差 `1.128e-11`（仅为回归对照，量纲与独立比较见逐项记录）。

先运行回归脚本时旧核心拒绝 native/2；新增能力实现后独立基准通过。报告单测发现 JSON 配置字段顺序误判并修复。一次验证脚本启动时构建尚未结束，Vite 文件 watcher 遇到锁定 obj；脚本关闭无必要的 watcher 后解决。桌面回放的前三次失败均为新增测试的 locator／对话关闭处理（status 匹配多个元素、Escape 不关闭计算书、两个关闭按钮）；限定 footer 与实际关闭按钮后通过，没有把失败记为产品通过证据。

复跑完整本任务通路：`npm run evidence:plan2:t214`。不重跑或改写旧安装候选，未执行真实 AI 新能力联测及完整 Electron 套件；本任务桌面场景通过不代表整轮验收。

审查后增加组合对象／分量／字段路径诊断、13 个原生非法输入与 IPC 诊断回归后复验。一次完整套件中既有 `electron/deepseek-chat.test.ts` 的 20 ms 超时场景在 200 ms race 前未结束；该文件单独 36 测试通过，随后完整套件重跑通过。未因本任务修改该网络测试或产品逻辑。

最终桌面复验中一次 `Ctrl+O` 未触发打开，测试改用实际“文件 → 打开项目／保存项目”菜单入口后重跑；这仍覆盖同一公开存储入口，不用内部状态替代重开。一次 PDF 导出未在测试默认 5 秒内完成，导出等待设为 30 秒后最终回放通过（18.5 秒执行、19.4 秒总计）；没有修改产品导出逻辑、数值容差或原生计算预算。
