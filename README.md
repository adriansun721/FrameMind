# FrameMind

面向空间刚架课程分析的 Windows 桌面工作台。当前完成 T01—T06：可手动建立多杆空间刚架，设置节点六自由度支座及集中力/力矩，本地计算位移、转角、反力和杆端内力，保存并重开带原始计算输入的项目。分析失败可查看阶段、定位对象并编辑修正，历史成功结果保持可用。求解在独立 Worker 中运行，界面显示阶段并支持取消；迟到结果不会覆盖已编辑或已切换的项目。三维视图支持核对局部轴、截面朝向和主动适合模型。

## 本地运行

```powershell
npm install
npm run dev
```

## 验证

```powershell
npm run typecheck
npm test
npm run test:e2e
```

项目文件使用 `.framemind` 扩展名和带版本号的 UTF-8 JSON 格式。架构及兼容规则见 `docs/decisions/`。

T04 的独立数值参考及验收证据见 [T04 验收记录](docs/evidence/T04-validation.md)。T05 增加失败阶段、对象/字段定位及支座和节点荷载属性修正，见 [T05 验收记录](docs/evidence/T05-validation.md)。T06 的任务隔离、阶段状态和取消证据见 [T06 验收记录](docs/evidence/T06-validation.md)。求解采用小变形 Euler-Bernoulli 空间刚接单元；均布荷载、自重、多工况与规模性能验收属于后续任务。
