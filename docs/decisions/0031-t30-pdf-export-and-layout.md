# T30 PDF 导出与版面核验

本决策覆盖 PLAN.md T30、US-054、US-055 与 AC-18，沿用 T28/T29 的冻结报告和附录选择契约。

## 同源内容与排版

正文和过程附录先生成 `ReportBlock[]`，Word 与 PDF 分别消费相同的标题、段落、表格、公式文本及图表 SVG。材料截面、荷载工况、自重、用户组合、结果数值、教材引用、缺失提示和补算标记只在共享内容入口组织，不为 PDF 另算一遍。数值继续采用七位有效数字显示；公式继续保留既有可编辑文本表示。

用户从工程计算书对话框选择 Word 或 PDF。每次导出在第一次异步操作前调用 `captureEngineeringReport`，冻结指定历史输入、响应、附录对象和步骤；后续排版不读取当前项目。两次独立导出的报告生成时间可以不同，分析时间及分析身份、全部计算内容保持一致。

Word 沿用 docx 生成可编辑内容及 PNG 图表。PDF 使用自包含 HTML、同源 SVG 图表及 Electron `webContents.printToPDF`，保留可搜索的中文与矢量图形。A4、20 mm 页边距、微软雅黑正文、9 pt 表格、重复表头、行内不拆页、表题与标题跟随后文、附录起新页和页脚页码组成首版排版约定。长名称允许中文和连续英文换行；矩阵沿用每块最多六个数值列，保留全部行和真实索引。模型图按预计文字边界省略拥挤或越界编号，图例说明省略规则，正文对象表保留完整稳定身份。

## 本地导出与失败边界

PDF IPC 与 Word 一样只接受主应用可信窗口及主 frame。建议文件名清理 Windows 非法字符，补齐扩展名，并支持中文目录。PDF 排版使用隐藏、无 preload、沙箱隔离的临时 BrowserWindow；独立内存 session 阻止外部网络及文件请求，主进程强制注入 CSP 禁止页面脚本、连接、表单和 base URL。内容文本按 HTML 转义，图表仅为内联 data URI。

主进程等待本地字体与图片解码完成后才打印；图表加载失败、超时、取消选择及文件写入失败均不返回成功。60 秒排版超时后销毁临时窗口；成功和其他失败同样保证清理。PDF 字节完成并确认签名后才进入既有 `ProjectFileStore` 临时文件与备份回滚入口，不提前截断旧文件。

## 依赖与打包边界

Electron 已是应用运行依赖，docx 已是 Word 运行依赖。本任务不引入 Word、LibreOffice、Python、Poppler、浏览器驱动或外部 PDF 服务作为产品依赖；生产构建包含主进程 PDF 模块和按需加载的共享报告/PDF 模块。微软雅黑使用目标 Windows 的系统字体，生成 PDF 后嵌入所用字体子集。

开发核验使用独立、不可见、只读的本机 Microsoft Word 实例打开 DOCX 并生成检查用 PDF，再接入 documents 技能 `render_docx.py` 的栅格化入口。这些工具仅是开发验证依赖。T34 仍须在干净 Windows 安装环境复验正式包；本任务的生产构建与桌面出口验证不代替 T34。

## 验证

用户确认以报告导出接口、Electron 文件接口和桌面导出流程为测试边界。TDD 验证同源内容与密集图表标签；文件边界模拟目标替换失败，保留原 PDF 字节并清理临时输出。桌面验证历史结果、原组合输入、所选附录、中文路径、重复导出、图表排版失败、写入失败、取消和临时窗口清理。

三组最终样本覆盖组合与部分过程、三杆件全部矩阵、21 杆件的长材料截面名称与跨页结果/自由度表。`scripts/verify-t30-layout.py` 对照 Word 每个正文段落及表格单元格与 PDF 的实际文本，检查字体嵌入及每页文字边界，同时保存两种格式的逐页 PNG。来源与实际结果见 [T30 验收记录](../evidence/T30-validation.md)。

实现 API 核对依据：[Electron webContents.printToPDF 官方文档](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions) 与 [BrowserWindow 官方文档](https://www.electronjs.org/docs/latest/api/browser-window)，核对日期 2026-10-02。
