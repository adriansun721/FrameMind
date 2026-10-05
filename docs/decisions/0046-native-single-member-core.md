# ADR-0046：C++ 单杆计算与 Windows 安装候选

- 日期：2026-10-05（Asia/Taipei）
- 状态：Accepted
- 范围：PLAN2.0 T2-13，延续 ADR-0045 的冻结 DTO、单位、符号及稳定 ID

采用独立 x64 C++17 可执行程序，每次请求新建进程。Electron 主进程固定可执行路径，通过 stdin JSON 和 stdout NDJSON 传递同一 `framemind-analysis/1` 请求、真实阶段及结果。渲染器通过已有 `startAnalysisTask` 的显式 `native-single-member` 选项调用；“计算”和 agent 正式入口继续采用 TypeScript。原生失败不回退到 TypeScript。

## 库、构建和候选比较

数值矩阵采用 Eigen 3.4.0，协议解析采用 nlohmann JSON 3.11.3。下载来源和 SHA-256 固定于 `scripts/build-native.ps1`，CMake 编译定义 `EIGEN_MPL2_ONLY`，关闭未验证的线程并行。Eigen 提供稠密／稀疏矩阵及后续方法的扩展边界；本任务只验证 12×12 稠密单元及约化方程。部分主元高斯消元由 C++ 执行，主元阈值保留 1e-12；Eigen 负责矩阵、坐标转换及恢复运算。没有把 TypeScript 刚度、位移或参考数值传给原生核心。

Eigen 的 [3.4.0 许可说明](https://gitlab.com/libeigen/eigen/-/raw/3.4.0/COPYING.README) 指明 MPL-2.0 与 `EIGEN_MPL2_ONLY` 的边界；[JSON 3.11.3 官方发布](https://github.com/nlohmann/json/releases/tag/v3.11.3) 提供版本和头文件 SHA-256。随包带未修改的 Eigen 对应源码、MPL 文本、JSON 完整头文件及 MIT 声明。MSVC `/MT` 按 [官方运行库说明](https://learn.microsoft.com/en-us/cpp/build/reference/md-mt-ld-use-run-time-library?view=msvc-170) 静态链接运行库；运行时不调用编译器、CMake、Node 或下载器。

比较 Node 原生插件（会耦合 Electron ABI，错误影响宿主进程）、WASM（不满足本次 Windows 原生安装通路）、独立进程（ABI 简单，退出与取消可独立处理）；选择独立进程。比较手写全部矩阵容器、Eigen、需要额外二进制运行依赖的 BLAS/LAPACK 通路；选择 Eigen 头文件方案。稀疏求解、完整静力及资源调度仍由 T2-14/T2-15 决定和验证。

## 已验证边界

仅两个节点、一根三维 Euler–Bernoulli 杆、零位移约束和节点端部力／力矩；支持局部截面转角。分布荷载和自重明确拒绝，完整迁移不提前开放。原生校验协议、自由度、单位、理论、求解版本、节点／资源引用、参数、工况依赖和组合有效荷载；原生版本为 `framemind-native/1`。节点数组顺序与杆件起终点顺序分别映射。

原生输出节点位移／转角／反力、杆端力、17 个实际沿杆恢复站位和整体矩阵过程。默认图形采样直接使用原生站位；任意位置截面内力在两个原生站位间线性插值，本任务没有分布力，内力场符合该插值。其他图形采样数及杆件过程页采用已标注的冻结输入重建公式，不能称作原生运行轨迹。整体组装快照与阶段来自原生；没有记录消元逐步轨迹。原生来源随项目保存，浏览时不按当前模型伪造过程。

服务核对请求／分析／项目身份、冻结输入、真实阶段、完整对象、有限数、实际矩阵和原生站位。失败不附加结果。主进程固定程序路径且检查可信主窗口；取消按窗口所有权及请求 ID 终止进程，迟到返回由 facade 丢弃。输入／输出各限制 4 MiB，单杆进程 30 秒预算。崩溃、截断和预算耗尽保留已经收到的阶段，再返回真实传输错误。阶段在原生执行时刻记录，单杆 transcript 在进程退出后整体校验并转交界面；本任务不提供运行中逐条 IPC 推送。

## 安装候选

`npm run package:win:native-candidate` 生成独立 T2-13 候选，包含 Electron 应用、原生程序和许可源码。原完整交付资料准备要求旧 T33 证据通过；当前工作区旧证据为 failed，不能用于本候选声明。专用配置只打包本任务的计算通路与验收范围，不改写旧证据。原 `package:win` 继续执行完整交付门槛，并新增构建和包含原生程序。

`node scripts/verify-plan2-t213-install.cjs` 在没有既有 FrameMind 注册安装时安装到临时中文目录，核对原生二进制 SHA-256、许可与对应源码，用系统 PATH 和独立资料目录在已安装应用中复跑全部单杆，再使用 NSIS 卸载。开发机移除 PATH 的运行验证不等同于干净 Windows；后者仍由 T2-44 验收。
