# FrameMind

面向空间刚架课程分析的 Windows 桌面工作台。当前完成 T01—T02：可创建和编辑空间节点、材料、截面与单根杆件，在三维视图核对局部轴和截面朝向，并保存、重新打开项目。

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
