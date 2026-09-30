# ADR-0001：T01 桌面技术栈与项目格式

- 状态：已接受
- 日期：2026-09-30
- 适用范围：T01 单节点本地项目闭环，后续任务可在验证后修订

## 决策

首版桌面壳采用 Electron，界面采用 React + TypeScript，三维视图采用 Three.js。Electron 主进程只负责桌面能力和文件系统边界；渲染进程持有统一的结构模型，通过启用 `contextIsolation`、禁用 `nodeIntegration` 的 preload 白名单访问打开与保存能力。

项目文件扩展名为 `.framemind`，内容为 UTF-8 JSON。根对象必须包含：

- `format: "framemind-project"`
- `formatVersion: 1`
- 稳定项目 ID、名称、创建和更新时间
- 模型修订号 `revision`
- 单位约定：长度 `m`、力 `kN`、力矩 `kN·m`
- 节点集合及下一节点编号

节点使用不随保存和重开变化的 `node_0001` 形式稳定 ID，显示编号使用 `N1`。全局坐标采用 X、Y、Z，界面约定 Z 轴向上。加载器拒绝未知格式、未来版本、重复身份和非法坐标，不静默修复。

保存时先在目标目录写临时文件；已有文件先移动为同目录备份，临时文件替换成功后才删除备份。任何替换失败都会恢复旧文件并向界面返回错误。

## 选择理由

- Electron 直接覆盖目标 Windows 桌面环境，并能在最终打包时内置运行时，无需用户另装 Node.js。
- React 适合后续项目树、属性面板、数据表和 AI 面板共享状态。
- Three.js 提供空间节点、后续杆件与结果图所需的 WebGL 场景能力。
- TypeScript 使模型、IPC 和文件格式边界保持显式契约。

## 已评估替代方案

- Tauri：安装包更小，但当前机器没有 Rust 工具链；在 T01 引入额外工具链会延后首个可验证闭环。
- WPF：Windows 原生集成好，但后续 WebGL 式三维交互和跨界面共享模型需要另一套前端方案。
- 浏览器应用：不满足独立 Windows 桌面应用、原生文件对话框和最终离线安装边界。

## 构建与未来打包边界

开发依赖 Node.js/npm；生产构建由 TypeScript 与 Vite 生成 `dist-electron/` 和 `dist/`。T34 将引入安装器配置、代码签名与干净 Windows 环境回归；届时 Electron 运行时随安装包分发，最终用户不需要 Node.js、Python 或求解环境。

## T01 验证证据

- `npm run typecheck`：渲染进程与 Electron 主进程类型检查。
- `npm test`：模型命令、格式兼容性、原子保存与失败回滚。
- `npm run test:e2e`：从真实 Electron 窗口创建节点、检查显示、保存、关闭、重新启动并打开文件。
- `npm run evidence:t01`：生成真实窗口证据图 `docs/evidence/T01-workbench.png`。
