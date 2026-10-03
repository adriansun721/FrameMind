# T34 交付验收索引

状态：候选交付，本机安装版离线、双主题固定回放和真实 DeepSeek 主流程通过。干净 Windows 回归及真人试用未执行，不得记为通过。完整桌面回归 74 项首次通过、1 项 PDF 导出等待超时后原样隔离复跑通过，4 项安装专用测试由独立安装验收覆盖。

## PRD 验收

| 验收 | 证据 / 当前状态 |
| --- | --- |
| AC-01 自然语言建模 | T21、T33：固定回放与真实 DeepSeek 技术验收 |
| AC-02 确认边界 | T22、T33：确认前保存隔离、事务应用 |
| AC-03 手动建模 | T03、T04；T34 安装版三种离线状态下手动单杆求解通过；干净环境待验收 |
| AC-04 视图同步 | T07、T20；数据表按已实施工作台设计合并至属性栏与项目树 |
| AC-05 批量修改撤销 | T08、T22、T26 |
| AC-06 荷载工况 | T09—T11、T24、T33 |
| AC-07 自定义组合 | T12、T24、T33 |
| AC-08 数值正确性 | T31：22 算例、7 无效/不稳定输入、独立参考 |
| AC-09 结果来源 | T14、T25、T33 |
| AC-10 前后对比 | T15、T26、T33 |
| AC-11 过程展示 | T17、T18、T29、T31 |
| AC-12 失败定位 | T05、T31 |
| AC-13 中断取消 | T06、T27；T34 安装版真实 1,120 杆 Worker 取消、重算通过 |
| AC-14 API 配置 | T19、T27；T34 安装版双主题真实 DeepSeek 流程通过 |
| AC-15 凭据处理 | T19、T27；T34 安装版 DPAPI 加密、移除、项目/报告隔离通过 |
| AC-16 双主题 | T16、T33；T34 安装版离线及在线截图、重启主题恢复通过 |
| AC-17 项目持久化 | T01、T04、T15；T34 中文路径及完整重启的输入/结果一致通过 |
| AC-18 双格式计算书 | T28—T30、T33；T34 安装版实际双格式导出通过，版面另行渲染核验 |
| AC-19 完整演示 | T33 技术流程通过；T34 安装版双主题在线主流程通过 |
| AC-20 真人首次使用 | **未通过**；T33-first-use.md 无真实参与者记录 |

需求映射以仓库 PLAN.md 第 6 节为准；以下逐项记录全部 62 项用户故事。此前任务证据不替代安装版和干净环境实测。首版完成必须同时通过 AC-01—AC-20，当前不得标为首版全部完成。

## 全部用户故事逐项核对

以下逐项检查了 PLAN 映射及既有证据文件的存在，并核对各任务验证范围；文件存在不代表最终安装或真人验收通过。原始证据路径位于源代码仓库 docs/evidence 与 docs/decisions。

| 用户故事 | 责任任务 | 判定 | 原始证据 |
| --- | --- | --- | --- |
| US-001 | T01、T34 | 本机安装回归通过；干净环境待验收 | 0001-t01-desktop-stack-and-project-format.md |
| US-002 | T16 | 既有任务技术证据可复核 | T16-validation.md |
| US-003 | T01、T04、T15、T34 | 本机安装回归通过；干净环境待验收 | 0001-t01-desktop-stack-and-project-format.md、T04-validation.md、T15-validation.md |
| US-004 | T16、T33 | 技术流程已验证；真人首次使用待验收 | T16-validation.md、T33-validation.md |
| US-005 | T16、T33 | 技术流程已验证；真人首次使用待验收 | T16-validation.md、T33-validation.md |
| US-006 | T16、T33 | 技术流程已验证；真人首次使用待验收 | T16-validation.md、T33-validation.md |
| US-007 | T16、T33 | 技术流程已验证；真人首次使用待验收 | T16-validation.md、T33-validation.md |
| US-008 | T01 | 既有任务技术证据可复核 | 0001-t01-desktop-stack-and-project-format.md |
| US-009 | T02 | 既有任务技术证据可复核 | 0002-t02-members-materials-sections-and-local-axes.md |
| US-010 | T02 | 既有任务技术证据可复核 | 0002-t02-members-materials-sections-and-local-axes.md |
| US-011 | T07 | 既有任务技术证据可复核 | T07-validation.md |
| US-013 | T07 | 既有任务技术证据可复核 | T07-validation.md |
| US-012 | T08 | 既有任务技术证据可复核 | T08-validation.md |
| US-018 | T08 | 既有任务技术证据可复核 | T08-validation.md |
| US-014 | T13 | 既有任务技术证据可复核 | T13-validation.md |
| US-015 | T02、T13 | 既有任务技术证据可复核 | 0002-t02-members-materials-sections-and-local-axes.md、T13-validation.md |
| US-016 | T02 | 既有任务技术证据可复核 | 0002-t02-members-materials-sections-and-local-axes.md |
| US-017 | T03、T23 | 既有任务技术证据可复核 | 0003-t03-spatial-frame-analysis.md、T23-validation.md |
| US-019 | T21、T24 | 既有任务技术证据可复核 | T21-validation.md、T24-validation.md |
| US-020 | T21、T24 | 既有任务技术证据可复核 | T21-validation.md、T24-validation.md |
| US-021 | T21、T24 | 既有任务技术证据可复核 | T21-validation.md、T24-validation.md |
| US-022 | T21、T24 | 既有任务技术证据可复核 | T21-validation.md、T24-validation.md |
| US-023 | T21、T24 | 既有任务技术证据可复核 | T21-validation.md、T24-validation.md |
| US-024 | T22、T26 | 既有任务技术证据可复核 | T22-validation.md、T26-validation.md |
| US-029 | T22、T26 | 既有任务技术证据可复核 | T22-validation.md、T26-validation.md |
| US-030 | T22、T26 | 既有任务技术证据可复核 | T22-validation.md、T26-validation.md |
| US-025 | T20、T26 | 既有任务技术证据可复核 | T20-validation.md、T26-validation.md |
| US-026 | T22、T23、T24、T26 | 既有任务技术证据可复核 | T22-validation.md、T23-validation.md、T24-validation.md、T26-validation.md |
| US-027 | T20、T27 | 既有任务技术证据可复核 | T20-validation.md、T27-validation.md |
| US-028 | T23 | 既有任务技术证据可复核 | T23-validation.md |
| US-031 | T03、T23 | 既有任务技术证据可复核 | 0003-t03-spatial-frame-analysis.md、T23-validation.md |
| US-032 | T09、T24 | 既有任务技术证据可复核 | T09-validation.md、T24-validation.md |
| US-033 | T10、T24 | 既有任务技术证据可复核 | T10-validation.md、T24-validation.md |
| US-034 | T11、T24 | 既有任务技术证据可复核 | T11-validation.md、T24-validation.md |
| US-035 | T12、T24 | 既有任务技术证据可复核 | T12-validation.md、T24-validation.md |
| US-036 | T12、T24 | 既有任务技术证据可复核 | T12-validation.md、T24-validation.md |
| US-037 | T03、T04、T23 | 既有任务技术证据可复核 | 0003-t03-spatial-frame-analysis.md、T04-validation.md、T23-validation.md |
| US-038 | T05 | 既有任务技术证据可复核 | T05-validation.md |
| US-039 | T05 | 既有任务技术证据可复核 | T05-validation.md |
| US-040 | T06、T32 | 既有任务技术证据可复核 | T06-validation.md、T32-validation.md |
| US-041 | T03、T04、T14 | 既有任务技术证据可复核 | 0003-t03-spatial-frame-analysis.md、T04-validation.md、T14-validation.md |
| US-042 | T03、T04、T14 | 既有任务技术证据可复核 | 0003-t03-spatial-frame-analysis.md、T04-validation.md、T14-validation.md |
| US-043 | T14 | 既有任务技术证据可复核 | T14-validation.md |
| US-044 | T14、T25 | 既有任务技术证据可复核 | T14-validation.md、T25-validation.md |
| US-045 | T11、T12、T14 | 既有任务技术证据可复核 | T11-validation.md、T12-validation.md、T14-validation.md |
| US-046 | T15 | 既有任务技术证据可复核 | T15-validation.md |
| US-047 | T15、T26 | 既有任务技术证据可复核 | T15-validation.md、T26-validation.md |
| US-048 | T25、T26 | 既有任务技术证据可复核 | T25-validation.md、T26-validation.md |
| US-049 | T17 | 既有任务技术证据可复核 | T17-validation.md |
| US-050 | T18 | 既有任务技术证据可复核 | T18-validation.md |
| US-051 | T18 | 既有任务技术证据可复核 | T18-validation.md |
| US-052 | T28 | 既有任务技术证据可复核 | T28-validation.md |
| US-053 | T29 | 既有任务技术证据可复核 | T29-validation.md |
| US-054 | T28、T30 | 既有任务技术证据可复核 | T28-validation.md、T30-validation.md |
| US-055 | T28、T29、T30 | 既有任务技术证据可复核 | T28-validation.md、T29-validation.md、T30-validation.md |
| US-056 | T03、T04、T31 | 既有任务技术证据可复核 | 0003-t03-spatial-frame-analysis.md、T04-validation.md、T31-validation.md |
| US-057 | T33 | 真人首次使用未验收 | T33-validation.md |
| US-058 | T32 | 既有任务技术证据可复核 | T32-validation.md |
| US-059 | T19 | 既有任务技术证据可复核 | T19-validation.md |
| US-060 | T19 | 既有任务技术证据可复核 | T19-validation.md |
| US-061 | T03、T19、T27、T34 | 本机安装回归通过；干净环境待验收 | 0003-t03-spatial-frame-analysis.md、T19-validation.md、T27-validation.md |
| US-062 | T27、T34 | 本机安装回归通过；干净环境待验收 | T27-validation.md |
