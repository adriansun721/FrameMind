# FrameMind

面向空间刚架课程分析的 Windows 桌面工作台。当前完成 T01：创建空间节点、三维显示、稳定对象身份，以及项目保存和重新打开。

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

项目文件使用 `.framemind` 扩展名和带版本号的 UTF-8 JSON 格式。架构及兼容规则见 `docs/decisions/0001-t01-desktop-stack-and-project-format.md`。
