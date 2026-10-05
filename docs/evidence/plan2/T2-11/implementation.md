# T2-11 实现与复跑

日期：2026-10-05（Asia/Taipei）。需求为 PLAN2.0.md T2-11 与 PRD2.0.md AC2-01—AC2-11。

- `npm run evidence:plan2:t211`：构建应用，执行固定契约集两次及八个 Electron 文件各两次。任何失败／缺测返回非零。
- `npm run evidence:plan2:t211:online`：构建应用，使用本机加密配置运行三条真实 DeepSeek 流程各两次。没有凭据记录 blocked，不以跳过代表通过。
- 协议：[protocol.json](protocol.json)。实现决定：[ADR-0044](../../../decisions/0044-agent-reliability-integration.md)。每次运行的协议、指标、环境、失败与实际输入／工具回执位于 `runs/<UTC timestamp>-<mode>/`；显示日期采用 Asia/Taipei。
- 模型由应用的连接配置决定，不在脚本中强制换模型。当前请求配置由 `electron/deepseek.ts` 定义：HTTPS `chat/completions`、工具自动选择、thinking disabled、非流式、max_tokens=2048，temperature/top_p 未显式设置。每个实际样本保存 `settings.model`。

新增桌面场景通过公开 UI、正式项目文件与 `loadChatHistory` 读取证据。完整本机回执用于读取类工具核查，便携工程只保存压缩后的工程任务证据。确定性模式只替换模型回复，工具执行、确认事务、Worker 求解、文件保存与 Electron 重启仍走正式实现。

真实联测发现的诊断次序问题已通过 `startAiTask` 回放复现：先试算、得到缺少副本的真实回执、模型创建副本后再试算。第二个回归验证模型重复忽略该条件时停止，并保留失败证据。工具 Schema 的分析来源字段与领域校验对齐；未知工程来源仍需补齐。

正式结果位移参考来自悬臂解析式 `F L³ / (3 E I)`：F=10000 N、L=4 m、E=200e9 Pa、I=1e-4 m⁴，预登记目标为 0.010666666666666666 m，绝对容差 1e-10 m。自重保留且不改变该横向参考。通过冻结原结果、唯一回执、已有对象和荷载身份核查确认是否只应用一次。

实验指标为固定场景的检查点通过率；失败率和缺测率均单独列出。`noRepeatedQuestions` 衡量已齐全任务是否直接到达待确认状态，不把普通说明文字中的问号算成缺参。真实副本试算必须带 `numerically-solved-not-engineering-validated`，不能把数值成功当作工程有效性的证明。
