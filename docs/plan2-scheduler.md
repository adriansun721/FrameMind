# PLAN 2.0 PowerShell 调度器

调度器按 `PLAN2.0.md` 的任务表读取 44 项任务及其直接依赖，串行运行，每次尝试均使用独立的 `codex exec` 新会话。已就绪任务优先 T2-01—T2-11、T2-41，其次工程／分析任务，最后 T2-39；不把编号当作依赖。Preview 给出当前状态下的完整模拟顺序。

## 启动与查看

在 Windows PowerShell 5.1 中运行，默认仓库为脚本所在项目，本机技能路径为 `%USERPROFILE%\.codex\skills\implement\SKILL.md`，CLI 使用 PATH 中的 `codex`。无需安装额外 PowerShell 模块。

```powershell
Set-Location D:\FrameMind
# 只创建状态，不调用 Codex，不执行业务任务
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action Init
# 查看状态和模拟调度，均不执行业务任务
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action Status
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action Preview

# 以下为将来实际执行计划的启动命令，本次配置时没有运行
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action Run
# 可先限制只执行一项
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action Run -MaxTasks 1
```

业务执行前，先自行审阅并处理已有未提交改动，将 PLAN2.0.md 和 PRD2.0.md 纳入需求基线提交。Run 在开始新任务时要求干净工作区，不会替你 stash、清理、提交或覆盖既有改动。CLI 须已登录；无需为调度器新增 API 密钥。实际子会话固定使用模型 `gpt-6.1-sol`、推理强度 `high`，并使用 `-s danger-full-access -c approval_policy="never"`，在本机获得实现、测试、审查及当前分支提交所需权限。任务完成会提交，但不会推送。

可指定 `-RepositoryRoot`、`-ImplementSkill`、`-CodexPath`（原生 `.exe`）、`-StateRoot`；重新运行时使用同一配置。默认每项超时 240 分钟，可通过 `-TimeoutMinutes` 修改。超时和停止检查覆盖输入传递、进程执行及日志管道收尾。Windows Job 持有工作进程及其后代，关闭调度器时整组结束；随脚本提供的 `WorkerJob.cs` 由系统 .NET 编译，无需安装开发工具。脚本按需运行，不注册开机、定时或自动重启任务，以免在未明确启动时执行业务计划。

## 状态、证据与完成门槛

默认状态目录为仓库实际 Git 目录中的 `plan2-scheduler`，一般即 `.git\plan2-scheduler`，不出现在业务提交中。持久内容包括：

- `state.json` 与原子替换备份 `state.json.bak`：任务状态、原始基线提交、每次尝试、进程身份、提交及人工验收记录。
- `PLAN2.0.md`、`PRD2.0.md`：初始化时的需求快照；运行中同样核对原始文件哈希，改变时拒绝继续，需审阅并显式迁移状态。任务进展记入 state.json，保持需求基线不变。
- `scheduler.jsonl`：状态事件。
- `attempts/<任务>/<尝试>/`：`prompt.md`、完整 `implement.SKILL.md` 快照、CLI `events.jsonl`、`stderr.log`、结构化 `result.json`、`scheduler-handoff.md`，以及人工通过后的 `human-acceptance.json`。
- `docs/evidence/plan2/<任务>/`：由任务会话生成、随实现提交的验收证据及交接记录。

每个提示词第一行显式调用 `$implement`，并强制第一个 shell 命令通过 `Get-Content -LiteralPath ... -Raw -Encoding UTF8` 读取本机技能全文。完成门槛检查新会话事件、首条成功命令及技能完整输出、技能快照哈希与结果声明。仅在提示词提及技能不算通过。

只有实现、验证、审查均通过且审查遗留问题为零，全部 PLAN 复选项都有通过证据，交接记录存在，完整 Git 提交确实是任务基线的后继，工作区干净，证据非空、哈希一致、在本任务中新增或修改且进入报告的提交，任务才会成为 `completed` 并释放直接依赖。启动后续任务还会重查已完成任务证据及提交祖先关系。自动检查能确认文件及提交的一致性；数值、真实 AI、桌面和安装证明的实质充分性由任务审查及相应人工验收判断。

输出 JSON 结构以 `scripts/plan2-scheduler/result.schema.json` 为准。验收索引对应任务详情中复选项从 1 开始的顺序。阶段证据必须分别登记 implementation、verification、review 类型；验证记录应包含实际命令、退出码和输出，审查记录包含范围、结论及问题处理。

## 暂停、中断与恢复

失败、CLI 非零退出、超时、证据缺失／失配、未通过验收条件均令当前任务 `paused`，停止整个队列，不跳去做其他任务，不自动重试。需要人工验收则停在 `needs_human`；如果仍有未通过复选项，则保留为 `paused`，补齐后新尝试重新检查。

```powershell
# 在另一 PowerShell 窗口请求停止；终止属于本次任务的进程树并保存已有输出
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action Stop
# 先查看并检查日志、交接记录和未完成代码，再显式继续
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action Run -Resume
```

Ctrl+C 的 finally 路径也会停止子进程、保存状态与交接。强制杀死调度器后，下一次 Run 会发现 `running` 状态；所有未完成状态中，仍存活的原进程都必须先用 Stop 结束。进程 ID 与启动时间同时匹配才会终止，避免误杀复用 PID。原进程已结束时转为暂停；`-Resume` 新建会话读取所有此前尝试的日志与交接，允许同一暂停任务的部分改动继续存在，仍会重验已完成依赖的证据。首次恢复后仍须提交、清洁工作区并重过全部门槛，才进入下一项。保留所有尝试，不使用 `codex exec resume` 或 `--last`。

启动进程前先保存 `launchPending`，写入进程身份并再次保存后才发送任务提示词。若恰在启动与身份写入之间被强杀，拒绝自动恢复。先用 `Get-CimInstance Win32_Process` 检查含该尝试 `result.json` 路径的命令行，结束对应的孤儿进程及子进程，确认无剩余工作进程后执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action RecoverLaunch -TaskId T2-01 -NoWorkerConfirmed
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action Run -Resume
```

RecoverLaunch 还会拒绝当前能发现的匹配工作进程；`-NoWorkerConfirmed` 是操作者对孤儿进程已清理的显式确认，不会启动任务。

活跃调度器持有文件独占锁；第二实例拒绝运行。状态以临时文件加原子替换保存，不会静默重置或自动退回旧备份。损坏时先保存原文件、比较 `.bak` 与真实代码／提交，再人工修复；恢复备份可能导致重复尝试，必须核查。

## 人工验收

计划详情包含真人、干净 Windows／干净系统、人工检查／核查／验收要求的任务，以及 AC 映射明确要求人工核查的责任任务，强制人工门槛（当前 T2-24、T2-39、T2-43、T2-44）。会话也可主动声明其他人工门槛。人工验收不能被 agent 的 passed 声明解除。

完成实际验收后，将说明、参与者／环境、操作、结果和限制保存为仓库证据并提交。由操作者提供 JSON 记录，填写当前待验收尝试的信息；例如：

```json
{
  "approved": true,
  "reviewer": "实际验收人",
  "acceptedAt": "2026-10-03T16:00:00+08:00",
  "taskId": "T2-39",
  "attemptId": "从 state.json 读取",
  "commit": "result.json 中的 40 位任务提交 SHA",
  "planHash": "state.json 中的 planHash",
  "evidence": [
    { "path": "docs/evidence/plan2/T2-39/human-check.md", "sha256": "文件 SHA256，使用小写" }
  ]
}
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action AcceptHuman -TaskId T2-39 -HumanRecord C:\path\acceptance.json
# AcceptHuman 只登记验收；执行下一项需显式 Run
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-Plan2Scheduler.ps1 -Action Run
```

如果真人、真实 AI、干净 Windows 环境或任何必需证据不可得，保持暂停，不以截图、旧证据、代码提交或自动回放替代。人工记录只接受当前暂停任务、同一尝试、同一任务提交及同一计划哈希，证据也必须非空、哈希一致并已提交。

## 验证调度器本身

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-Plan2Scheduler.ps1
```

测试在 `.scratch` 下独立 Git 仓库使用确定性的本机 CLI 替身，验证调度、日志／技能门槛、失败停机、提交／证据门槛、人工验收和中断恢复，不启动真实 Codex、不执行 FrameMind 业务任务。测试目录保留，便于检查。真实业务运行仍须用实际 Codex，测试替身不能作为业务验收证据。
