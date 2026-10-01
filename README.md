# FrameMind

面向空间刚架课程分析的 Windows 桌面工作台。当前完成 T01—T11：可手动建立多杆空间刚架，设置节点六自由度支座及集中力/力矩，本地计算位移、转角、反力和杆端内力，保存并重开带原始计算输入的项目。分析失败可查看阶段、定位对象并编辑修正，历史成功结果保持可用。求解在独立 Worker 中运行，界面显示阶段并支持取消；迟到结果不会覆盖已编辑或已切换的项目。属性面板和数据表共享节点、杆件的编辑草稿与提交入口，三维视图和项目树同步已应用模型；数据表支持多选批量移动/转角、复制删除，以及成组撤销重做。杆件均布力支持全局/局部坐标、三维方向箭头、编辑保存与撤销，并可按沿杆位置查询实际截面内力。节点荷载、均布荷载及结构自重可明确归属不同工况；工况支持创建、修改、删除、独立求解、保存重开和响应比较。

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

T04 的独立数值参考及验收证据见 [T04 验收记录](docs/evidence/T04-validation.md)。T05 增加失败阶段、对象/字段定位及支座和节点荷载属性修正，见 [T05 验收记录](docs/evidence/T05-validation.md)。T06 的任务隔离、阶段状态和取消证据见 [T06 验收记录](docs/evidence/T06-validation.md)。T07 的双向编辑、输入校验及保存重开证据见 [T07 验收记录](docs/evidence/T07-validation.md)。T08 的批量事务、复制删除及撤销重做证据见 [T08 验收记录](docs/evidence/T08-validation.md)。T09 的均布荷载解析参考、内力恢复与桌面流程见 [T09 验收记录](docs/evidence/T09-validation.md)。T10 的自重闭环见 [T10 验收记录](docs/evidence/T10-validation.md)。T11 的多工况数值参考和切换、保存重开证据见 [T11 验收记录](docs/evidence/T11-validation.md)。操作历史只在当前应用会话内保留，项目文件只保存模型与分析结果。求解采用小变形 Euler-Bernoulli 空间刚接单元；荷载组合与规模性能验收属于后续任务。
