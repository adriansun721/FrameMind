# T2-14 实现

日期：2026-10-05（Asia/Taipei）。开发基线：`08282805d65b9bea0c2a22569b45f070b7dba4cc`。

技术决定见 [ADR-0047](../../../decisions/0047-native-full-static-regression.md)。

`native/src/static-analysis.hpp` 实现完整空间静力，复用 T2-13 的单元和协议基础。`main.cpp` 按版本明确分派旧单杆／新完整静力；没有静默回退。新增 `NATIVE_STATIC_SOLVER`，保持旧原生版本及既有结果兼容。`startAnalysisTask` 提供显式 native-static 后端，“C++ 静力试算”使用当前冻结工况／组合输入。

`project-file.ts` 对新版本核对完整对象、阶段、有限数、站位、矩阵采集边界和每根杆的自由度映射。`analysis.ts` 支持新原生结果当前性、任意位置的均布荷载内力查询、图形与过程。计算书附录配置对照改为字段顺序无关的值比较。

原有 UI、agent、报告内容体系均复用；正式计算入口切换属于 T2-15。宿主仍采用 ADR-0046 的每请求独立进程、4 MiB 输入／输出及 30 秒限制；本任务不声明典型大规模完整输出已经通过。
