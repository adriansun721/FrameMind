# PLAN 2.0 调度器验收与交接

日期：2026-10-03（Asia/Taipei）

范围：仅 PowerShell 调度器、Windows 进程生命周期辅助类、结构化结果契约、离线测试和操作文档。业务计划未执行。本次读取并应用本机 `C:\Users\小红薯\.codex\skills\implement\SKILL.md`，完成验证、双轴审查与当前分支提交；已有业务改动与未提交需求文件不纳入本次提交。

## 验证

环境：Windows PowerShell 5.1.26100.9444；本机 `codex-cli 0.146.1`。CLI 参数依据本机 `codex exec --help` 核查；未调用真实 `codex exec` 模型会话。

| 检查 | 结果 |
| --- | --- |
| `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-Plan2Scheduler.ps1` | 退出 0；25 项全部通过 |
| `npm.cmd run typecheck` | 退出 0；两个 TypeScript 项目通过 |
| `npm.cmd test` | 退出 0；40 个文件、284 个测试通过 |
| 三个 PowerShell 文件的 PS 5.1 Parser 检查 | 0 个语法错误；UTF-8 BOM 保证中文路径／规则可正确解析 |
| Git whitespace 检查 | 通过 |
| 本项目 `-Action Init` 与 `-Action Preview` | 退出 0；44 项均 pending，业务尝试 0 |

最终逐项测试记录：[plan2-scheduler-tests.json](./plan2-scheduler-tests.json)。完整临时仓库与各尝试的事件、结果、交接保留在 `.scratch/plan2-scheduler-tests/7b64499e30ac45f79b47694aa4d6b5f7/`；该目录不随源码提交。

测试使用编译出的本机 CLI 替身，经过实际 Windows 原生命令行传参、UTF-8 stdin/stdout、子进程及独立 Git 提交；不联网，不调用真实 Codex，不实现 PLAN 中的产品功能。覆盖直接依赖与 agent 优先、首命令技能全文读取、新会话身份、实现／审查／验收／提交门槛、证据失配、全局暂停、计划变更、状态损坏、人工验收、锁、显式恢复、未知启动身份、暂停状态仍有活进程、大输入阻塞、后代占用输出管道、强杀父进程清理及计划损坏后的停止控制。

自动门槛确认记录、文件、哈希和提交的一致性；真实数值、AI 联测、人工桌面核查、真人试用、干净 Windows 安装的实质证据仍须在业务任务实施时完成。没有用本次替身测试替代这些验收。

## Standards

审查基点：`608adc8f22df4236bb43b71e50dd3d284c84a089`；仅本次调度器文件。独立审查已清除所有发现：恢复时重验已完成依赖，所有未完成状态检查存活工作进程，输入与输出收尾统一受停止／超时监督，Windows Job 清理工作进程及后代。最终复查无剩余具体问题。

## Spec

独立需求审查依据用户调度要求与 `PLAN2.0.md`。启动身份未知时拒绝自动重试，T2-24 从 AC2-21 映射继承人工门槛，RecoverLaunch 补写交接记录；运行中需求基线变化会暂停，计划无效不阻断 Stop。最终复查无剩余需求问题；独立确认本项目 44 pending、0 attempts。

## 交接

入口：[Invoke-Plan2Scheduler.ps1](../../scripts/Invoke-Plan2Scheduler.ps1)。使用及暂停恢复命令：[操作说明](../plan2-scheduler.md)。默认状态已在 `.git/plan2-scheduler/state.json` 初始化，无业务工作进程。

将来启动前，操作者需先自行审阅和处理当前既有未提交内容，并将 `PLAN2.0.md`、`PRD2.0.md` 纳入基线提交；调度器会拒绝脏工作区开始新任务。然后用 `-Action Run` 开始；失败后检查尝试目录、代码和提交，再用 `-Action Run -Resume`。人工验收按说明提供已提交证据及与任务／尝试／计划／提交绑定的操作者记录。

调度器本身未注册定时／开机任务，未启动业务会话，未推送提交。本次配置的实际模型运行留待操作者显式启动。进程在 Job 绑定前存在极短的启动窗口；此时任务提示词尚未发送，且 `launchPending` 使恢复拒绝自动重试，需按说明核查孤儿进程。
