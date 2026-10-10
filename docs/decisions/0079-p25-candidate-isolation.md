# ADR-0079：候选分支、父状态保护与受控恢复

日期：2026-10-10（Asia/Taipei）

范围：PLAN2.5 P25-08，沿用 ADR-0078 项目 sidecar。真实多 agent 启动、受控截面生成和工程数值检查分别由 P25-09—P25-11 接入。

每个候选由本机 host 生成新的 taskId、candidateId，以及 `candidate/task_<uuid>` 分支。分支真实 fork 自 `candidate-round` 父提交，后续候选提交只更新该分支；不会写源码仓库。任务证据放在已核验 sidecar 的 `candidates/task_<uuid>/` 中，work 接口不接受目录、分支名、shell、Git 参数或命令。工具只有 fork、submit、list、read、cancel；主控 inspect、merge 和 restore 独立于 work 的工具分发器。它是数据工具权限边界，不承诺操作系统沙箱；未来 P25-10 给 agent 的工具列表必须只暴露受限入口。

父绑定包括项目和 history 身份、会话、工程 revision、父提交、完整内容 SHA-256 和工程输入规范化 SHA-256。输入覆盖几何、资源、支座/荷载、自重、工况/组合、分析设置、PSD 与所选分析来源；对象键排序，数组顺序保留。候选只能改变工程输入、相应计数、revision 和更新时间，不能改项目身份、任务执行记录、导入回执、历史身份或既有分析结果。结果证据单独绑定 SHA-256，不能冒充正式结果。候选提交后不可原地修改，通过新任务重新检查。

编辑/恢复/切换立即改变主进程上下文；取消立即置 cancelled，不等排队中的 inspect 返回。检查前后以及 Git 发布前后复核父状态。主控合并还在项目写锁内读取真实 main 父提交，拒绝其他窗口已经改变的工程状态，绝不静默三方合并。候选历史可在 stale/cancelled 后读取；迟到提交保存到任务内新 evidence 文件，保持原分支及主状态。重试有新身份和 retryOf。复制和进程重开不恢复旧执行任务。

合并只接受具体候选 commit。受信任的本地 inspector 在 host 构造时注入，工作工具及 IPC 不接收外部通过报告；完整报告必须绑定候选 commit、输入/结果哈希，检查字段、有限数值、阈值和证据哈希必须有效。合并前重新回读候选、inspect 和结果证据。正式桌面当前没有注入数值 inspector，明确返回 blocked / P25-11，没有强制合并入口。专项测试和后端证据使用明确标注的协议 checker fixture 验证门控；这些数值不代表真实工程可行性，不能用于 AC25-13 或在线验收。

合并整体发布 merge-before / merge-after 两个 checkpoint。回执先写后发布，避免发布后回执写失败导致拒报成功；发布期间发生取消/父变化时，以 CAS 补偿恢复原主引用。补偿失败保留错误诊断且不报告成功。重开会核验预写 merged 回执的实际提交可达性，未发布的回执降为 stale。主引用操作与保存使用同一项目队列和 sidecar 写锁。原项目文件在用户保存前保持上次保存内容，与其他确认操作一致；成功应用后的项目处于未保存状态，checkpoint 可恢复。

恢复选择任务父提交、快照提交或明确提交之一。界面先按现有完整 project decoder 校验所选不可变快照，host 验证提交可达性、项目身份及内容哈希，创建新的 restore checkpoint；revision 单调增加，保留当前 historyId，清除执行任务及导入 AI 确认。应用后重新捕获冻结输入并调用既有结果来源判定，旧结果的来源不重写。缺支座、荷载等仍按既有求解就绪检查处理，不因恢复而假装可计算。

桌面入口为“文件 → 候选与差异”和“文件 → 项目历史”。差异包括对象新增/删除、字段修改及数组顺序，显示父值、候选值、人工编辑值。父状态任何变化都禁止合并，即使字段不直接相交；人工变化也显示在差异中。历史可以按任务、候选快照身份或提交筛选，并确认整体恢复。

复验：`npm run test:plan2:p2508`；`npm run evidence:plan2:p2508`；`npm run build && node scripts/run-e2e-isolated.cjs e2e/p25-08-candidates.spec.ts e2e/p25-07-history.spec.ts e2e/p25-06-import.spec.ts --workers=1`。
