# T2-15 实现记录

日期：2026-10-05（Asia/Taipei）。开发基线：`ea600d2b15888134cdb928d9d6e6cffeeb59bd38`。

正式“计算”、agent 确认续算、诊断副本和历史过程补算使用 `framemind-native/2`。移除试验按钮；TypeScript 为显式测试参考，原生失败不回退。诊断分为纯准备／证据归档及异步原生执行，避免工程持久化模块导入浏览器 Worker 入口。

主进程增量解码阶段，按窗口和请求推送 IPC；renderer 核对推送与最终记录。输入、输出、运行时间、并发及 Windows 提交内存都有运行前登记的预算。取消立即结束任务且终止进程，资源直到 close 才释放。窗口关闭、异常退出、重新加载和应用退出收束原生任务。协议、输入身份、数值和结果完整性校验通过才发布成功。

详细职责、预算、取消边界、历史政策和 Windows 依据见 [ADR-0048](../../../decisions/0048-native-production-isolation.md)。原数值算法、参考及容差未调整。

复跑：

```powershell
npm run evidence:plan2:t215
npm test
npm run package:win:native-production
node scripts/verify-plan2-t213-install.cjs --t215
```

agent 确定性桌面回放另外运行：

```powershell
$env:FRAMEMIND_T211_OUTPUT = 'docs/evidence/plan2/T2-15/agent-replay'
node scripts/run-e2e-isolated.cjs e2e/plan2-t2-11-reliability.spec.ts --grep 'whole-task|evidence-based'
```

测试用硬故障 executable 单独构建，位于 `native/build/Release`，不会复制进 `native/bin` 或安装包。原生核心与依赖许可沿用 T2-13/T2-14，MSVC 运行库继续静态链接。
