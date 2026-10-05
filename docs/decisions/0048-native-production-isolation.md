# ADR-0048：正式静力入口与原生故障隔离

- 日期：2026-10-05（Asia/Taipei）
- 状态：Accepted
- 范围：PLAN2.0 T2-15；延续 ADR-0039/0045/0047
- 审查基线：`ea600d2b15888134cdb928d9d6e6cffeeb59bd38`

## 正式入口

手动、agent 确认续算、诊断副本及历史过程补算默认使用 `framemind-native/2`。工具计算沿用任务调度器的单资源槽；诊断计算占用所属 agent 的槽。主进程再限制一个存活原生进程，覆盖报告补算等独立入口，资源占用返回可重算失败。取消发出终止进程，Promise 立即结束，进程资源直到实际 close 才释放。没有原生到 TypeScript 的回退。

移除桌面的两个试验按钮。TypeScript `solveFrame`、同步诊断及 `typescript-reference` 明确仅为测试／独立对照保留；桌面同步诊断拒绝数值计算，实际 agent 始终走异步原生任务。旧结果仍可读，冻结输入矩阵与沿杆查询重建不执行新的整体求解。单杆 `/1` 仅保留兼容协议和原数值参考。

## 进程、阶段与失败

固定打包路径、一请求一进程、无 shell 或 renderer 自定参数。stdout 按 UTF-8 行增量解码，校验身份、阶段次序和完整终态。完整行到达立即发送所属窗口的请求级 IPC；renderer 在 dispatch 前订阅，合并最终回执时核对已推送阶段，不重复推进。关闭、崩溃或重新加载窗口取消其所有原生进程；应用退出关闭服务。结果只有在 exit=0、协议和所有数值／对象／输入／过程校验通过后发布。

输入 16 MiB、输出 64 MiB、运行 120 秒、一个并发进程是本任务事先登记的运行预算，均为实际字节／时间／资源边界，不是任意节点数量限制。Windows Job 对核心提交内存设 512 MiB 预算；部署环境可用 `FRAMEMIND_NATIVE_MEMORY_MIB` 在 16–512 MiB 间收紧，非法配置受控失败。预算建立失败不给出无约束计算。`bad_alloc` 返回资源不足；极端 OOM 若不能输出诊断，由 host 记录异常退出及已经收到的真实阶段。解析前资源失败没有可读请求 ID，host 只为该隔离进程的明确资源失败补充所属身份，禁止此规则用于成功包。

[Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) 与 [扩展限制结构](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)说明 process memory limit 对进程提交内存的限制；这不是 RSS/工作集上限。[嵌套 Job](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs)允许适用 Windows 下父进程 Job 与子进程预算共存；实际构建和 Electron 运行验证这一运行边界。保留 MSVC 静态运行库 `/MT`，不引入需另装的运行库。

## 竞态与历史

原生 task 的订阅、输出和取消绑定 request ID。scheduler 绑定 project/task，App 继续核对 project/session/revision。编辑、切项目及取消后迟到消息不能写入新上下文；上下文变化时旧完成输出被丢弃，不冒充当前结果。已有保存结果按冻结输入保留并判断过期；本任务不新增自动保存迟到成功输出的政策。

## 首次测量前登记的验证

- 不改 T31 独立参考、容差、近零规则或 T2-14 过程校验；复跑 22 个有效及 7 个无效基准。
- 真实进程 fixture 注入硬终止、截断和协议错配；真实核心收紧内存预算注入资源不足；renderer 注入非有限／部分／错来源输出。所有失败保留模型、旧结果和已收到阶段，恢复正确核心后可重算。
- 10 秒未完成原生进程期间旋转、查看、编辑与取消；renderer 取消反馈不超过 500 ms，进程终止不超过 2 秒。阶段在终态前可见，取消无部分成功。项目切换与取消后新计算不串身份。
- 在同一机器、同一 200 杆星形模型上各测 3 次 TypeScript 测试参考与 C++ 请求耗时和内存。TypeScript 指标为 Node 进程 maxRSS，C++ 为 Windows Job 峰值提交内存；定义不同，分别登记，不用两者计算内存节省率。另测 Electron renderer 操作、事件循环与应用工作集。结果是切换基线，不能替代 T2-42 的约 1,000 节点／3,000 杆性能验收。
- 标准 Windows System32 PATH 与依赖检查验证无需编译器；安装完整候选并复用正式入口。干净 Windows 与真人试用仍属于 T2-44/T2-43。

验证与审查归档在 [T2-15](../evidence/plan2/T2-15/verification.md)。
