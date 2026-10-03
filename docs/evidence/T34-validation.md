# T34 Windows 候选安装交付验收记录

日期：2026-10-03（Asia/Taipei）。范围：Windows x64 NSIS 完整安装器、安装版离线与真实 DeepSeek 回归、示例和质量材料。**干净 Windows 实测及 T33 真人试用未执行；T34 和首版尚未全部完成。**

## 输入、构建及操作

契约见 [ADR-0035](../decisions/0035-t34-windows-delivery.md)。固定完整演示输入为 [t33-demo.json](../fixtures/t33-demo.json)，项目/报告复制时核对既有通过记录的逐项 SHA-256 及 fixtureSHA256。单杆离线参考 L=4 m、E=200 GPa、A=0.01 m²、Iy=0.0002 m⁴、Iz=0.0001 m⁴、J=0.00015 m⁴、起点六自由度全固定，终点 Fy=6 kN；解析 Uy=0.0064 m、Ry=-6 kN，误差要求 1e-10。取消测试沿用 T32 的 1,120 杆固定输入。

使用 Windows 11 10.0.26200 x64；Electron 44.5.1，Vite 8.3.1，electron-builder 26.17.0。版本 0.1.0 为首版候选。最终安装器、app.asar、exe、资料清单哈希及 runId 以 [installation.json](T34/installation.json) 为准；完整交付 ZIP 自带 delivery-manifest.json 与外部 SHA256SUMS.txt，不以截图证明代码版本。

安装器在本机新建临时中文目录按当前用户静默安装，通过安装后实际 exe 启动，断言 app.isPackaged。逐项检查安装资料哈希和实际文件集合。测试后使用卸载器清理，并确认 exe 已移除。已有注册安装时拒绝运行验证，避免覆盖用户版本；非零安装退出也必须先卸载，无法证实卸载成功时保留目录。

## 本机结果

| 验证 | 实际结果 / 证据 |
| --- | --- |
| 类型检查 | 通过，前端及 Electron 两套 TypeScript 配置 |
| 单元测试 | 38 文件、273 项全部通过 |
| 完整开发版桌面回归 | 74 项首次通过、1 项 T30 PDF 导出等待超过原有 5 秒；失败项不改实现或等待时限，隔离复跑通过。4 项安装专用测试由下列独立入口覆盖 |
| 未配置 API | [unconfigured](T34/unconfigured/validation.json)：从空项目手动建模、失败修正、解析值核对、报告和完整重启通过 |
| 配置后移除 | [removed](T34/removed/validation.json)：真实 DPAPI 加密与移除、重启无凭据，全部本地流程通过 |
| 配置但连接失败 | [disconnected](T34/disconnected/validation.json)：连接/对话网络失败，模型及旧结果保留；手动流程、导出和重启通过 |
| 取消与恢复 | [cancellation](T34/cancellation.json)：取消真实 Worker 后无成功结果；再次计算只产生一份成功结果，1,120 杆输入保持一致 |
| 固定工具回放 | [深色](T34/workflow/replay-dark/validation.json)、[浅色](T34/workflow/replay-light/validation.json)：完整阶段、两次结果、引用、成组撤销/重做和双格式导出通过；不计作在线验收 |
| 真实 DeepSeek | [深色](T34/workflow/online-dark/validation.json)、[浅色](T34/workflow/online-light/validation.json)：复用本机已配置的加密凭据，真实 HTTPS、无 fetch 替换，全流程通过；密钥不写入证据 |
| Word/PDF 页面 | [layout-results](T34/workflow/layout-results.json)：四组产品 PDF 各 16 页、Word 原生渲染各 22 页，共 152 页；全文/逐单元格来源核对无缺失、页边界无越界、所选分析 ID 一致。总览检查及代表页原尺寸抽查，无阻塞显示缺陷 |
| 安装和卸载 | installation.json：中文路径安装、包内依赖启动/求解/导出、资料精确清单及卸载通过 |
| 需求映射 | [逐项索引](../release/T34-acceptance.md)、[机器可读映射](T34/requirements-map.json)：62 个唯一用户故事、20 项 AC，明确记录未通过项目 |

四组完整演示均核对独立力平衡及所选柱修改范围、冻结分析来源和可点击数值引用。固定回放记录可能来自较早的候选归档，其各自 exe/app.asar 哈希保留；最终交付安装器以最终真实在线和离线 installation.json 记录绑定，不把旧记录的版本身份改为新版本。

本地离线行为通过 Chromium offline 和主进程 HTTPS 网络边界拒绝重现；应用在临时工作目录及只含 Windows/System32 的 PATH 启动。**本机有开发工具，不是干净系统，也未执行操作系统物理断网。**包内 PDF 使用 Electron 排版；本机 Word、Python 和 Poppler 仅用于开发质量核验。

## 失败迭代、审查与资料保护

首次安装用例在报告关闭按钮命中两处、过早使用快捷键时失败；修正测试定位和界面就绪等待后通过。完整回归期间另一个安装回归共用 test-results 导致部分取证文件冲突；安装回归改为独立 `release/t34-test-results`。原有 T30 测试隔离复跑通过，保留首次超时事实，不将首次整套运行写成全绿。

独立 code-review 的 Standards 轴先发现 staging 残留、部分安装失败未走卸载、取消测试残留旧 passed 记录；Spec 轴发现固定输入哈希缺口、staging 残留及沙箱清单路径错误。已修正，复核两轴均 0 项剩余发现。打包前清理经校验的 staging，安装后检查实际文件集合；各测试在启动前写 running，成功/失败落盘，取消记录包含身份、时间和归档哈希。

完整回归前备份并逐字节恢复 314 份原有证据，保留用户截图和文件修改；用户原有 PLAN-UI.md 删除、教材 PDF、Python 缓存不纳入提交。生产依赖 `npm audit --omit=dev` 为 0 项；开发打包依赖审计仍有 8 项 high（http-cache-semantics 传递链），不将生产无发现表述为全仓库安全验收。

最终资料重新生成时，一次安装验证与构建重叠，哈希核对发现记录仍绑定上一轮安装器及资料清单，因此未用该记录生成交付 ZIP。等待最终构建完成后重新安装验证；交付脚本同时核对安装器、资料清单和文件、实际在线归档及各轮报告 QA 的 runId，避免重新构建或重跑后沿用旧成功证据。

## 复现及待验收

```powershell
npm ci
npm run package:win
npm run evidence:t34
npm run evidence:t34:online
npm run delivery:t34
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/new-t34-sandbox.ps1
```

在线命令产生 DeepSeek API 用量，需当前 Windows 用户先在开发版配置可用凭据。离线回放只使用虚构测试凭据。原生 Word/页面核验：`python scripts/verify-t33-layout.py --renderer <documents技能render_docx.py绝对路径> --evidence-root docs/evidence/T34/workflow`；原尺寸 PNG 在系统临时目录，非产品依赖。

待实际验证的项目：启用 Windows Sandbox 或使用没有开发工具的目标 Windows，断开操作系统网络后按生成清单安装、求解、保存重开及双格式导出；确认目标系统中文字体显示和导出。随后由未读手册的真实首次使用者完成核心流程、记录并复验卡点（AC-20）。本机无 Sandbox，已提供可执行 WSB 生成器及记录模板，没有虚构干净环境或真人通过。候选包尚未代码签名，默认使用 Electron 图标；最终交付状态如实保留这些限制。
