# T2-25 验证记录

日期：2026-10-06（Asia/Taipei）。

通过项：

- `npm run build:native`：Windows Visual Studio 2026 / Eigen 3.4.0 原生构建。
- `npm run typecheck`、`npm run build`：类型检查、Electron 主进程及生产渲染构建。
- `npm test`：73 个文件、550 个测试全部通过。
- `node scripts/verify-plan2-t225.mjs`：17 个独立原生算例、152 项预登记量纲／残差检查通过。记录见 numerical-results.json。
- 新增工程／原生测试：8 个测试，包含草案确认、读回、非法释放、撤销、复制、保存、旋转局部轴、脱开转动、机构、组合自重、分割和报告。
- Electron 定向回归：T2-13 原生单杆、T2-14 空间静力、T2-20 手动与工具工程拓扑、T2-24 实体渲染、T2-25 手动释放与 agent 确认，共 7 项通过。
- 截图人工检查：releases-light-1080.png、releases-dark-1440.png；杆端环与实体及节点支座同时可见。其余双主题／双宽度截图同目录。

开发中的红阶段：工具原先不能解析释放字段；原生原先不支持 `/3`；简支梁均布挠度原先只有三次插值。对应测试先失败，再随实现通过。桌面测试最初使用了错误的控件角色／名称，修正为已有公开控件后通过；没有为测试添加后门或替换求解数据。

现有 Vite 大包提示、Three CJS 弃用提示与 NO_COLOR/FORCE_COLOR 提示仍存在。没有完整重跑全部 Electron 历史场景，定向回归范围如上。没有执行真实 AI、重新制作安装包或干净 Windows 实测，不能将本机原生构建当作这些验收。
