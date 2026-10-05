# T2-15 逐项验收

| PLAN2.0 要求 | 证据与结果 |
| --- | --- |
| 手动、agent、诊断切 C++；禁止静默回退 | 默认原生 task 单元验证；桌面正式入口 22 算例；`agent-replay/confirmation-0.json` 和 `diagnostic-0.json` 核对 `/2`；无 bridge 明确失败；补算 origin 实际核心验证 |
| 长计算真实阶段、可旋转、可取消、无部分成功 | 真进程 fixture 在 solve 等待 10 秒，手动状态栏和 agent 时间线均即时显示实际阶段；相机改变、取消反馈 3.5 ms、含 PowerShell 观测成本的进程终止确认 562.2 ms；旧结果保留 |
| 原生异常、协议、退出、非有限、资源不足 | 真实硬终止／截断／身份错配；renderer 非有限／部分／错来源输出拒绝；Windows 16 MiB 内存注入在 recovery 返回资源不足，同一 200 杆输入恢复预算后成功；host 字节、时间、并发边界测试 |
| 编辑、切项目、取消、新任务竞态 | 桌面延迟真实成功包，编辑后不应用；运行中打开另一工程取消旧计算，新工程只有自己的结果；unit 验证取消后迟到阶段和终态隔离；既有历史不丢失 |
| 切换响应／内存基线及安装依赖 | 201 节点／200 杆／1,206 DOF，同输入三次 TS 测试参考与原生基线；Electron 工作集和事件循环记录；开发机安装候选 22 算例在 System32 PATH 全通过，并卸载候选 |

完整原始数值和故障：[runtime-results.json](./runtime-results.json)；桌面：[desktop-isolation.json](./desktop-isolation.json)、[desktop-results.json](./desktop-results.json)；旧单杆回归：[single-member/desktop-results.json](./single-member/desktop-results.json)；安装：[installation.json](./installation.json)、[installed-desktop.json](./installed-desktop.json)。

参考测量为 Node 进程峰值 RSS（含 Vite），原生测量为 Job 峰值提交内存，不能据此计算内存节省比例。取消反馈测的是 renderer 点击到状态提交，进程终止时间包括 PowerShell 查询启动。原生大结果解码／展示仍在 renderer，目标规模响应门槛继续由 T2-42 验证。

本项完成的是正式静力切换与确定性、数值、进程和安装候选验证。没有重新运行真实 AI 联测；回放不冒充真实 AI。不是干净 Windows 验收，亦不声明 T2-42/T2-43/T2-44 已通过。
