# ADR-0081：反向设计单轮多 agent 编排

日期：2026-10-10（Asia/Taipei）

P25-10 在既有已确认固定场景和候选接口上交付单轮 main/work/inspect 编排。main 是主进程受控调度器；三个 work 各自通过独立 DeepSeek 请求循环探索激进减重、稳健逐级缩小和独立策略。三个上下文只含同一真实父输入、库资源和固定规则，不含其他 work 的候选、对话、路径或凭据。主进程先创建三个不同候选分支和输出身份，共用一个 `candidate-round` 父提交，再并发派发请求。

通信 schema 为 `reverse-agents/1`，提示版本 `p25-10/1`。记录模型、完整提示版本/哈希、工具 schema/哈希、编译模块和原生核心的构建哈希，以及 temperature=0、thinking=disabled、max_tokens=2048。每个请求校验任务启动时冻结的模型标识，连接设置改变后不能混入另一个模型。已有 DeepSeek 连接负责加密凭据、有限传输、网络失败与取消；渲染层不能指定 agent 工具。

work 白名单只有 `generate_candidate`、`solve_candidate`、`finish_work`；inspect 白名单只有 `read_candidate_evidence`、`submit_inspection`。未知工具、多余参数、其他轮的任务、直接通过文本和伪造来源均拒绝。每个 agent 最多 8 次 API 请求，工具失败最多重试 2 次；work 120 秒、inspect 90 秒。work 计时从独立上下文任务启动起包含 API、工具、排队、重试和证据写入；inspect 同样包含读取与结构化报告。父分支创建属于 main 准备时间，计入轮次总耗时。P25-12 再接入跨轮的 8 轮/20 分钟限制、去重和反馈，不在本任务宣称搜索收敛。

`NativeAnalysisHost.runQueued` 与手动求解共用单原生进程资源，等待真实进程 close 后才进入下一次求解；取消不提前释放仍存活的进程。时间线分别记录 API 起止、求解排队和实际进程执行。领域协议通过构建时打包的 `reverse-native-domain.cjs` 复用现有 `captureAnalysisInput`、`createAnalysisRequest`、项目与分析结果解码器，避免复制冻结组合和结果校验规则；Windows 打包包含该模块。

inspect 重新从候选 Git 快照及持久化 `result.json` 读取候选与真实原生消息，校验父/候选身份、提交、内容、冻结输入、结果和质量哈希。程序重算来源、资源、刚度完成、最大水平位移、整体力与力矩残差和质量来源；全局力矩参考点为固定原点 (0,0,0) m，荷载取真实求解等效节点向量，包含组合、自重和均布荷载。报告保留值、门槛、通过状态、严重级别和建议。work 的 feasibility 是可追溯的检查观察；主候选状态仍为 submitted，P25-11 尚未接入受控比较和合并，不能凭该报告将候选改成 passed。

证据保存在项目 sidecar 的 `rounds/round_<uuid>/`，候选和求解完整证据仍在各自 `candidates/task_<uuid>/`。manifest 使用相对证据身份和哈希。正式模型、支座和荷载不被候选改写。取消、工程编辑、恢复、项目切换、窗口关闭或重新加载终止 agent 和排队求解；迟到输出只能作为证据。新轮次使用新 run/task 身份。

验证沿用 ADR-0080 已确认的公开候选接口和桌面入口：真实 Git/原生求解集成测试覆盖并发与隔离、inspect 独立读取、任意命令拒绝、编辑/恢复/切换/取消；桌面覆盖确认前禁用、启动与结果、无凭据明确失败、正式模型不变。在线联测复制现有加密连接配置到隔离临时桌面 profile，不导出解密密钥；在线记录与离线故障回归分开标记。`npm run evidence:plan2:p2510:online` 新建在线证据，`node scripts/verify-p25-10.mjs` 验证现有完整证据。
