# ADR-0020：T19 DeepSeek 设置与本机凭据

- 日期：2026-10-02
- 状态：已接受；真实在线连接待用户自备凭据验证
- 范围：连接配置、凭据生命周期、测试反馈；AI 工具调用由 T20 起实现

## 官方接口核对

实施时实际读取以下官方页面，HTTP 均为 200：

- [首次 API 调用](https://api-docs.deepseek.com/)：OpenAI 格式地址为 `https://api.deepseek.com`，聊天入口为 `/chat/completions`，Authorization 使用 Bearer Key。
- [模型与定价](https://api-docs.deepseek.com/quick_start/pricing)：当前请求模型为 `deepseek-flash` 和 `deepseek-v4-pro`；前者对应 DeepSeek-V4.1-Flash，后者对应 DeepSeek-V4-Pro-0813。
- [聊天接口](https://api-docs.deepseek.com/api/create-chat-completion)：`thinking.type=disabled` 支持非思考模式，`stream=false` 支持单次 JSON 响应，`max_tokens` 最小为 1。
- [错误码](https://api-docs.deepseek.com/quick_start/error_codes)：401 认证、402 余额、429 限流、500/503 服务故障。
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)：Windows 使用 DPAPI，保护其他 Windows 用户访问；同一登录用户下其他进程仍可能解密。

按用户选择，默认显示 DeepSeek-V4.1-Flash，发送官方请求标识 `deepseek-flash`。界面也提供官方 Pro 模型选项。没有把未经官方资料确认的 `deepseek-v4.1-flash` 字面值发给服务。

## 决策与边界

凭据及模型标识整体加密保存在 Electron `userData/deepseek.credentials`。仅 Windows 且 `safeStorage.isEncryptionAvailable()` 为真时允许保存或解密；安全存储不可用时拒绝写入，绝不降级明文。使用已安装 Electron 44.5.1 的同步 DPAPI 接口处理至多 512 字符的凭据，Windows 路径不涉及交互式密钥环提示。加密发生在写文件之前，临时文件也仅包含密文；同目录原子替换，失败保留原凭据。保存/移除/读取串行执行。

密钥只在输入草稿、IPC 传入参数和主进程请求的短暂内存中存在；保存提交立即清空界面草稿，设置查询不返回密钥或密钥片段。关闭设置会销毁输入草稿。凭据不写入 localStorage、项目 schema、求解输入、历史、任务记录或普通日志，也不向报告导出入口提供。此安全边界不能防止同一 Windows 用户下的恶意进程、管理员、调试器或内存转储。

主进程仅接受应用主窗口主 frame 的连接 IPC；阻止窗口导航到其他地址及打开外部窗口。网络地址固定为官方 HTTPS 入口，禁止重定向，界面无法指定接收凭据的任意服务器。连接测试不接收项目、选择或求解输入。

测试使用固定消息 `Reply OK.`，非思考、非流式、最多 8 个输出 token。15 秒超时覆盖请求及响应正文读取。只有有效 assistant 文本响应才标记成功；远端正文和底层异常均不回传，错误结果只采用固定状态与反馈。测试产生少量 DeepSeek token 用量，不自动重试。

更新/移除凭据或启动新测试会取消旧测试，迟到结果返回失效状态。设置组件卸载后忽略旧响应，重新打开从主进程加载当前设置。连接失败保留配置，本地建模、求解和项目保存不依赖连接状态。

## 替代方案

不采用环境变量或项目字段保存用户凭据，避免随工程分享；不采用 localStorage 或明文 JSON 文件。Windows Credential Manager 需要额外原生绑定，已有 Electron DPAPI 能满足首版的本机凭据隔离要求。未为其他平台引入不经验证的安全存储后备方案。
