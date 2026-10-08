# T2-43 验收对应

需求：US2-001—US2-084；AC2-01—AC2-22。

当前判定：**自动化桌面主线通过；T2-42 目标规模性能和真人首次试用仍待验收，不能登记 T2-43 全部完成。**

| 范围 | 证据 | 状态 |
| --- | --- | --- |
| 既有工程续作、事实读取、隔离试算、整体草案、一次确认、重启恢复、继续计算 | [mainline-one-0.json](mainline-one-replay/mainline-one-0.json) | 自动化通过 |
| 参数补全、条件确认、静力计算、真实结果引用和前后对比 | [深色 validation](mainline-two-replay/replay-dark/validation.json)、[浅色 validation](mainline-two-replay/replay-light/validation.json) | 自动化通过 |
| Word/PDF、保存重开、网络失败后模型保留 | 双主题 `validation.json`、`计算书.docx`、`计算书.pdf` | 自动化通过 |
| 深浅主题、1080／1440 窗口和窄面板 | 双主题截图及 `validation.json` | 自动化通过 |
| 自由建模、连接／释放、质量、屈曲、二阶、模态、随机响应的独立桌面入口及连续性重开 | [advanced-continuity.json](advanced-continuity.json)、T2-20—T2-36 `desktop.json`；汇总见 [automation-summary.json](automation-summary.json) | 自动化通过，未冒充同一真人会话 |
| 浏览／手动编辑竞态、拒绝、撤销、过期结果、缺参数和失败恢复 | 主线一隔离／恢复记录、主线二网络失败记录及既有 T2-20—T2-36 失败分支 | 自动化覆盖 |
| 真人首次试用 | [human-check.md](human-check.md) | 待真人 |
| 目标规模性能前置依赖 | [T2-42 验收](../T2-42/acceptance.md) | 部分完成 |

真人记录未提供前，不能使用代码提交、截图或自动化回放替代真人参与者、任务完成率、干预次数和问题清单。
