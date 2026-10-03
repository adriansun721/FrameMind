$ErrorActionPreference = 'Stop'
$recordPath = 'C:\Evidence\sandbox-startup.json'
$record = [ordered]@{ outcome = 'running'; cleanEnvironment = 'Windows Sandbox'; networking = 'Disabled by WSB'; startedAt = (Get-Date).ToUniversalTime().ToString('o') }
try {
  $installers = @(Get-ChildItem -LiteralPath 'C:\Delivery' -Filter 'FrameMind-*-Windows-x64-Setup.exe')
  if ($installers.Count -ne 1) { throw 'Expected exactly one installer in the delivery folder' }
  $record.installerSHA256 = (Get-FileHash -LiteralPath $installers[0].FullName -Algorithm SHA256).Hash
  $record.developmentTools = @('node.exe', 'npm.cmd', 'python.exe', 'WINWORD.EXE') | ForEach-Object { @{ command = $_; found = [bool](Get-Command $_ -ErrorAction SilentlyContinue) } }
  $process = Start-Process -FilePath $installers[0].FullName -ArgumentList '/S', '/D=C:\FrameMind' -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installation failed: $($process.ExitCode)" }
  $exe = 'C:\FrameMind\FrameMind.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw 'Missing installed executable' }
  $record.archiveSHA256 = (Get-FileHash -LiteralPath 'C:\FrameMind\resources\app.asar' -Algorithm SHA256).Hash
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
  New-Item -ItemType Directory -Path 'C:\Evidence\中文离线回归' -Force | Out-Null
  Copy-Item -LiteralPath 'C:\FrameMind\resources\交付资料\示例项目\两层钢刚架-修改后.framemind' -Destination 'C:\Evidence\中文离线回归\演示.framemind'
  # This visible app is the interactive acceptance surface for the human tester.
  Start-Process -FilePath $exe -WindowStyle Normal | Out-Null
  $record.outcome = 'installed; awaiting interactive acceptance, not passed'
  $checklist = @'
# 干净 Windows 离线验收（必须填写真实结果）

网络由 Sandbox 禁用。未安装开发工具、求解器或 Word。
请记录 Windows 版本、日期、安装包哈希和每一步实际结果；不要把此模板视为通过记录。

- [ ] 界面正常启动；设置里未配置 API。
- [ ] 从空模型手动建两节点单杆：L=4m，E=200GPa，A=0.01m²，Iz=0.0001m⁴，起点全固定，终点 Fy=6kN。
- [ ] 本地求解得到端点 Uy=0.0064m、起点 Ry=-6kN（绝对误差≤1e-9）。
- [ ] 查看位移、反力、杆端内力；切换深浅主题并截图。
- [ ] 保存 C:\Evidence\中文离线回归\手动.framemind，导出手动.docx 和手动.pdf。
- [ ] 关闭应用，从开始菜单重新启动，打开手动项目，确认输入和历史结果一致。
- [ ] 打开 演示.framemind，查看两次结果及前后对比，重算并导出 Word/PDF。
- [ ] 配置虚构 Key sk-sandbox-fixture，再移除；重算、保存重开和导出继续可用。
- [ ] 虚构 Key 保存但网络断开时，AI 请求失败，已确认模型和本地结果仍可用。
- [ ] 取消计算、无效模型失败后可以修正并重新计算；保留历史成功结果。
- [ ] 项目和报告不含虚构 Key；收集截图、项目、Word/PDF 至 Evidence。
- [ ] 卸载完成，不删除已保存项目。

结论：待执行。失败原因/卡点：待填。验证人：待填。
关闭 Sandbox 后 C:\Evidence 保留在主机 release/sandbox-evidence；其他沙箱数据被清除。
'@
  Set-Content -LiteralPath 'C:\Evidence\验收清单.md' -Value $checklist -Encoding UTF8
} catch {
  $record.outcome = 'failed'
  $record.failure = $_.Exception.Message
  throw
} finally {
  $record.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordPath -Encoding UTF8
}
