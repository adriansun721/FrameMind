# 手动能力与 Agent 工具覆盖

审计日期：2026-10-07。只读快照使用冻结工程身份，分页报告 total/hasMore/nextOffset；所有正式修改都需要确认。高级操作既可作为独立原子批次，也可纳入同一整体任务。

| 手动能力 | Agent 入口 | 共享执行或读取 | 主要测试 |
|---|---|---|---|
| 查询、选择、筛选 | read_model/read_objects/read_selection | ai-tools 冻结快照、分页 | ai-tools、ai-task |
| 自由 XYZ、框架及绘杆 | create/update_node(s)、draw_member、propose_task.frame/edits | project、work-plane | free-geometry、model-edits、task-draft |
| 节点/杆件复制删除 | duplicate/delete_node/member(s)、edits | project-operations 及关联清理 | model-edits |
| 连接、分割 | connect_members/split_member、edits | topology | topology、task-draft |
| 近邻检查、节点合并 | inspect_near_nodes/inspect_node_merge/merge_nodes | node-merge | node-merge |
| 材料及目录导入 | read_model materials、edits create/update/duplicate/delete_material | project、resource-library；保留溯源 | model-edits、task-draft |
| 自定义/参数化/目录截面 | read_section_contract、edits create/update/duplicate/delete_section、assign_section | section-geometry、catalog-section、project | parametric-sections、catalog-sections、section-stage |
| 局部方向、荷载方向 | update_member.rotationDegrees、conditions.coordinateSystem | member-geometry、load-stage | model-edits、load-stage |
| 支座 | propose_task.supports、edits delete_support | project add/update/deleteSupport | task-draft、analysis-conditions |
| 端弯矩释放 | update_member.endReleases | member-releases；显式 My/Mz | member-releases、model-edits |
| 点质量、线质量 | set_node_mass、update_member.additionalLineMassKgM | additional-mass；kg、kg/m | additional-mass、task-draft、units |
| 节点/均布荷载、自重 | propose_task.nodalLoads/uniformLoads/selfWeight、edits 删除 | project、load-stage | load-stage、task-draft |
| 工况与组合 | propose_task.loadCases/loadCombinations、edits 删除 | load-stage、project；级联及历史保留 | analysis-cases、model-edits |
| 五种分析工况 | read_model analysis-cases、edits create/update/delete_analysis_case | project、analysis-cases | modal、buckling、second-order、random-response |
| 模态阻尼 | edits set_modal_damping | modal-damping；绑定冻结 modalAnalysisId | modal、model-edits |
| PSD 输入 | prepare_psd_input、read_model psd-spectra、edits create/update/delete_psd_spectrum | psd-input、psd-project；单位及非法密度守卫 | psd-tools、psd |
| 模型检查、隔离诊断试算 | inspect_diagnostics、create/read/discard_diagnostic_copy、run_diagnostic_trial | diagnostic-trial、diagnostic-tool-task | diagnostic-trial、ai-task |
| 本地求解与结果比较 | request_analysis/propose_task.analysis、read_comparison/read_comparison_result | analysis-task、native-analysis-task、ai-comparison | analysis-intent、ai-comparison |
| 五方法结果、过程、冻结输入 | read_results/read_result | result-inspection、ai-results；真实数值 token | result-inspection、ai-results、T2-41 桌面联测 |

没有源码编辑、shell、脚本执行或自动优化入口。结果解释仍须真实引用，不能从响应数值给出安全或规范合格结论。禁止能力、过期输入、取消、超预算、无进展和传输失败沿用 T2-11 公共边界契约测试。
