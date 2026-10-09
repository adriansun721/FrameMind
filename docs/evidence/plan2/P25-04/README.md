# P25-04 预览实现与验证记录

当前交付：受限工程中心线识别、人工接触审查、节点/切分/异常预览、X/Y/Z 位姿记录、JSON 导出及正式工程隔离。指定 STEP 识别状态为 blocked，任务验收为 pending。不能将界面测试通过理解为指定装配重建通过。

指定输入 SHA-256：54d793bcf649d1e89d315c108e7e7faa61bd62cddf9737c1e56fda7b13c8fdca，960432 字节。

有效证据：

- [命令行运行清单](runs/15cc455c-7fdf-4133-8793-346d3f07e85e/run.json)：8 实例、3 实体定义、0 工程中心线、8 阻塞；完整诊断位于同目录 preview.json，哈希在清单中。
- [指定输入桌面清单](desktop/9c94d80c-df80-442a-94a2-03f0ed816dc7/desktop.json)：真实菜单导入、来源定位、位姿记录与关闭重开、专用 IPC 导出、保存正式项目并比较节点/杆件/修订、正式编辑使草稿失效。包含深浅色 1080/1440 截图及完整导出 preview.json。
- [解析棱柱桌面清单](desktop/be274ac5-49a3-4742-ac1a-b81d2949ac45/desktop.json)：100×100×1000 mm 平面对称棱柱提取 1 m 中心线与两个端节点，同样验证位姿、导出及正式模型隔离。

根 run.json 撤销早期错误证据：该版本曾将 822 个 BREP LINE 参数当作杆长，输出伪中心线与虚假的 passed 状态。该结果无效，不作为验收参考。旧运行目录未纳入此次交付证据。

验证结果：npm run build（含双端 typecheck）通过；P25-04 Node 测试 6 项通过；P25-03 中间态回归 1 项通过；CAD host 与拓扑 Vitest 合计 11 项通过；真实 Electron 场景 2 项通过。回归覆盖半圆柱形心误判、曲面顶点定位保留、开放端环、变截面、空间交叉、共线重叠和接触链折叠同一原杆。

全量 npm test -- --maxWorkers=2 结果为 697 通过、2 失败（89 个文件中 87 通过）。失败为 result-inspection.test.ts 的 buckling factor citations 和 stability-report.test.ts 的 frozen buckling patterns，均在 decodeResult/decodeBucklingResult 调用路径报“项目包含无效分析结果”。工作区已有未提交的 project-file.ts、buckling.ts 和原生屈曲相关修改；这些文件未被 P25-04 改动或纳入本次提交。全量结果保持失败记录，不宣称全绿。

## Standards

独立规范审查确认发布配置缺模块、阻塞实体遗漏范围、短杆接触自环三项问题已修复。对应回归已补充，未发现未修复的确定性代码错误或文档规范违规。

## Spec

独立需求审查确认圆弧形心误判及同杆不同边界折叠两项 P1 已修复。指定 STEP 保持 8 个阻塞项；PLAN 的“已完成”及早期零阻塞证据已撤销。平面直边闭合对称截面外的识别、曲面完整外包络、OpenCascade 级内核及 P25-01 独立 CAD 对照仍未完成。

审查结果：Standards 无未修复代码发现；Spec 的指定模型识别与独立 CAD 验收仍待完成。

复验命令见 [ADR 0075](../../../decisions/0075-step-centerline-topology-preview.md)。命令行每次写入新的 UUID 目录，不复用旧运行身份。桌面截图与导出哈希绑定同次实际导入。
