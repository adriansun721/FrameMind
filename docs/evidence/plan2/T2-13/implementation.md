# T2-13 实现记录

日期：2026-10-05（Asia/Taipei）。基点 `a96a4cc`。

Windows 桌面增加“C++ 单杆试算”，经既有统一分析请求和任务 facade 调用独立 C++ 进程，计算三维杆件刚度、约束消元、位移、反力、端力及 17 个沿杆站位。结果与真实阶段／矩阵同源保存；原正式 TypeScript 入口保留。方案、依赖、许可、安装与限制见 [ADR-0046](../../../decisions/0046-native-single-member-core.md)。

[criteria.md](./criteria.md) 在首次新增求解运行前登记独立参考与容差。9 个成功算例、702 项检查及 4 个输入／求解失败用例通过，未修改 `t31-references.json`。[numerical-results.json](./numerical-results.json) 包含实际量值和残差；[wire-samples.json](./wire-samples.json) 包含原生请求、响应和用于桌面重跑的工程。

首次验证脚本以严格 JS deepEqual 比较解码后的可选 `undefined` 字段以及 JSON 往返的负零，产生非数值失败；改为既有工程值等价比较后通过，没有修改求解、参考或容差。桌面九个算例经按钮计算、浏览、保存、重开及旧正式入口回归通过。

复跑：

```powershell
npm run evidence:plan2:t213
npm run package:win:native-candidate
node scripts/verify-plan2-t213-install.cjs
```

T2-14 继续承担完整多杆、均布荷载、自重与组合回归；T2-15 承担正式入口切换与完整故障调度；T2-44 承担干净 Windows 验收。
