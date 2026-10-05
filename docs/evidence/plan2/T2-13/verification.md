# T2-13 验证记录

日期：2026-10-05（Asia/Taipei）。基点 `a96a4cc`，初始实现 `27750c4`，最终结果包含两轴审查修订。

| 验证 | 命令／证据 | 结果 |
| --- | --- | --- |
| 原生编译 | `npm run build:native` | C++17、MSVC 19.51.36256.0、x64 Release、/MT 通过 |
| 类型与生产构建 | `npm run build` | 两份 tsc 与 Vite 通过，保留既有大包提示 |
| 全量单元测试 | `npm test` | 54 文件、423 测试全部通过 |
| 独立原生数值 | `node scripts/verify-plan2-t213.mjs`；[完整结果](./numerical-results.json) | 9 个算例、702 项分量／平衡／矩阵残差检查及 6 个失败用例全部通过 |
| 桌面公开入口 | `e2e/plan2-t2-13-native.spec.ts`；[桌面记录](./desktop-results.json) | 9 个按钮计算、浏览、保存／重开；真实机构失败不登记结果；旧正式入口通过 |
| 既有统一服务 | `e2e/plan2-t2-12-analysis-service.spec.ts` | 真实 Worker、保存、重开和 Word 同源阶段通过；未覆盖其原证据文件 |
| 畸形协议／取消 | `native-analysis.test.ts`、`analysis-task.test.ts`、`native-result.test.ts` | 启动失败、截断、退出码、超时、所有权取消、迟到隔离、部分输出及错误 DOF 映射被拒绝 |
| 安装候选 | `npm run package:win:native-candidate`；[安装记录](./installation.json)、[已安装应用记录](./installed-desktop.json) | NSIS 安装到临时中文目录，系统 PATH 下离线复跑 9 算例、保存重开、真实失败与旧入口，再通过 NSIS 卸载 |
| 原生运行依赖 | MSVC `dumpbin /DEPENDENTS native/bin/framemind-core.exe` | 仅 KERNEL32.dll，没有动态 VC 运行库依赖 |
| 两轴审查 | [review.md](./review.md) | 两项需求 P2 已修复并独立复查；无阻断项，保留一项 T2-14 维护性建议 |

独立参考 SHA-256 为 `64c378ed7d7fc521f8a39fc38da2383715b4e6b77a25a771232b1a469cdac31b`，与 T2-12 相同。参考和容差未改。六个失败用例为非法材料、非法截面、断资源引用、转动机构、刚度溢出和错误单位。

首次验证脚本的可选 undefined／负零严格比较失败，修正为既有工程值等价比较；首次完整交付准备被当前旧 T33 failed 证据阻止，未修改旧证据；独立候选首次 Electron 下载超时，改用已安装的固定 Electron 44.5.1 后打包通过。审查畸形自由度用例先复现失败，修正后通过。

应用及子进程 PATH 仅 Windows System32，不访问 AI 或网络。安装记录核对候选和原生程序 SHA-256，并检查对应源码与许可已打包。测试机器仍是开发主机，不等同干净 Windows。原生阶段在实际执行时记录，短单杆任务在进程退出后转交完整 transcript；没有运行中阶段 IPC 推送或消元逐步轨迹。T2-14/T2-15/T2-44 继续负责后续范围。
