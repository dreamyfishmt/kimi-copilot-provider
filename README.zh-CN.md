# Kimi Code Provider for Copilot

[English](README.md) | 简体中文

在 VS Code Chat 和 Agent 模式中使用你的 Kimi Code 订阅。扩展通过你自己的 API Key 直接连接 Kimi Code API。

扩展 ID：`dreamyfishmt.dreamyfishmt-kimi-code`。本项目并非 Kimi 或 GitHub 官方扩展。

## 为什么选择这个插件？

- **在 VS Code 内使用已有的 Kimi Code 订阅。** 填写自己的订阅 API Key，即可在现有 Chat 和 Agent 界面中使用 Kimi。选择 Kimi Code 端点时，模型请求直接发送给 Kimi Code，无需经过扩展运营的中转服务。
- **编码、聊天和工具调用集中在同一个工作流。** 支持流式回复，可向支持图片的模型提供截图或图片，也可让 Agent 使用 VS Code 的工具处理项目。在模型选择器中切换 Kimi 与其他已配置的聊天提供商，无需转到独立聊天应用。
- **自动跟随 API 提供的模型目录。** 从服务端读取模型名称、上下文限制和支持的能力。按账号与端点隔离的缓存，让已发现的模型在后台刷新期间仍可使用；手动刷新即可检查目录更新，无需自己编辑模型列表。
- **按任务调整思考强度与输出预算。** 支持的模型在选择器中提供思考强度选项；可配置的输出 Token 预算会在上下文窗口内为回复预留空间。所需 VS Code API 可用时，通过原生思考组件展示推理过程。
- **在额度影响工作前掌握用量。** 状态栏显示五小时和每周账号用量，悬停卡片提供进度条、重置倒计时及刷新、控制台快捷入口。额度独立轮询，不与聊天请求相互阻塞；刷新失败时保留上次数据并标记过期。每次请求由服务端返回的输入、输出 Token 数也会记录并传给 Copilot Chat，原生显示效果取决于安装版本。
- **一键诊断正在使用的配置。** 检查已加载账号、实时模型发现，以及普通响应和流式响应。分阶段结果和可复制的脱敏报告，帮助定位配置问题，也便于反馈问题，无需复制 API Key 或聊天内容。诊断请求会消耗账号额度。
- **密钥与可选设备信息由你控制。** API Key 通过 VS Code 原生秘密字段配置，扩展不会在模型缓存中另存一份密钥。主机名、系统和设备详情、设备 ID 请求头默认关闭；可按使用环境选择 Kimi Code 中国、海外端点或兼容的自定义端点。

## 功能

- 自动发现模型，按账号和端点隔离缓存，支持手动刷新。
- 状态栏显示五小时和每周账号额度用量，每 60 秒独立刷新。
- 流式文本回复和 Agent 工具调用。
- 将服务端返回的输入、输出 Token 用量传给 Copilot Chat。
- 在所需 API 可用时，原生显示思考过程。
- 支持图片，以及 text/plain 和 JSON 数据附件。
- 可配置输出 Token 预算和思考强度。
- 一键诊断已加载账号、模型发现、普通响应及流式响应，支持复制脱敏报告。
- 提供 Kimi Code 海外、中国端点及自定义地址。

本扩展提供聊天模型，不替换 Copilot 的行内代码补全模型。即使所选 Kimi 模型支持视频，本扩展也尚未实现视频附件。

## 环境要求

- VS Code 1.120.0 或更新版本，与扩展清单一致。
- VS Code 中可使用 Chat / Agent 功能。
- 有效的 Kimi Code 订阅，且拥有所选模型的访问权限。
- 从 [Kimi Code 控制台](https://www.kimi.com/code/console)获取的 API Key。
- 从源码构建时需要 Node.js 和 pnpm。

Kimi Code 订阅 Key 与 Kimi 开放平台 Key 不能互换。模型与套餐信息请参考 [Kimi Code 模型文档](https://www.kimi.com/code/docs/en/kimi-code/models.html)。

## 下载并安装最新版 VSIX

可以直接从 [GitHub Releases](https://github.com/dreamyfishmt/kimi-copilot-provider/releases) 下载已打包的插件，无需自行编译源码。

1. 打开 Releases 页面，选择最新发布的版本。Nightly 标有 **Pre-release（预发布）**；查找最新 nightly 时请查看发布列表，不要只看 GitHub 的 **Latest** 标记，该标记用于正式版。
2. 展开 **Assets（附件）**，下载以 `.vsix` 结尾的文件，例如 `dreamyfishmt-kimi-code-X.Y.Z-nightly.vsix`。请选择 VSIX 安装包，而不是源码 ZIP 或 tarball。
3. 在 VS Code 中打开扩展面板，点击 **…**，选择 **Install from VSIX…（从 VSIX 安装…）**，选中刚下载的文件，按提示重载窗口。已有旧版本时，也可以用同样步骤安装新版 VSIX 进行更新。

## 快速开始：完成配置并开始聊天

1. 按上方步骤下载并安装发布版本的 VSIX，或按照下文“从源码运行”启动开发版本。
2. 按 **Ctrl+Shift+P**（macOS 为 **Cmd+Shift+P**），搜索 `Kimi Code`。中国访问选择 **Kimi Code: Set API Endpoint to China (kimi.com)**，海外访问选择 **Kimi Code: Set API Endpoint to Global (kimi.ai)**。
3. 打开 Chat，从模型选择器进入 **Manage Language Models（管理语言模型）**，添加 **Kimi**，填写控制台中的 **Kimi Code 订阅 API Key**。密钥由 VS Code 原生提供商配置界面管理，不要写入用户设置或仓库文件。
4. 选择一个 Kimi 模型。如果没有出现模型，重新打开模型选择器，或运行 **Kimi: Refresh Models**。
5. 从命令面板运行 **Kimi: Diagnose Current Configuration**，选择准备使用的模型，在 **Kimi** 输出通道查看各项检查结果。诊断会发送两条小型测试请求，并消耗账号额度。
6. 新建聊天，先问一个简短问题。使用 Agent 时，可以先让它读取并总结一个测试文件。支持的模型可在选择器中调整 **Thinking Effort（思考强度）**；通过 `kimi.maxOutputTokens` 调整输出预算。

状态栏显示的是账号已用额度。点击可刷新额度或打开控制台。连接异常时，重新运行诊断，反馈问题时可复制脱敏报告。

## 从源码运行

1. 在 VS Code 中打开本仓库。
2. 安装依赖并编译：

   ```sh
   pnpm install
   pnpm run compile
   ```

3. 打开“运行和调试”，选择 **Run Kimi ext**，按 **F5**。
4. 在新打开的 **Extension Development Host** 窗口中继续配置和使用。

仓库中的启动配置不会在启动前自动编译。修改 TypeScript 后，需要重新编译并重启调试；也可在开发时运行 `pnpm run watch`。

## 配置提供商

1. 按 **Ctrl+Shift+P**（macOS 为 **Cmd+Shift+P**）打开命令面板，搜索 `Kimi Code`。
2. 中国访问选择 **Kimi Code: Set API Endpoint to China (kimi.com)**，海外访问选择 **Kimi Code: Set API Endpoint to Global (kimi.ai)**。
3. 打开 Chat，从模型选择器进入 **Manage Language Models**。
4. 添加 **Kimi** 并输入 Kimi Code API Key。该字段在提供商配置中声明为秘密字段。
5. 选择 Kimi 模型并新建聊天。

未配置 API Key 时，提供商不返回模型。请通过原生提供商界面配置密钥，而不是写入仓库或下面的设置示例。

## 模型与上下文预算

当 VS Code 提供已配置的 API Key 后，扩展从 `<baseUrl>/models` 获取模型。模型 ID、名称、上下文长度、图片和工具能力、思考支持、思考强度选项及默认值均以服务端元数据为准。仅展示兼容 Chat Completions 的模型，声明其他协议的模型会被跳过。已知模型缺失的元数据使用下表中的兼容信息；未知模型使用保守能力和 32K 上下文后备值。

成功查询会替换模型目录，包括返回空目录的情况。公开模型元数据保存在 VS Code 扩展存储中，以端点和密钥的 SHA-256 指纹隔离，缓存中不保存密钥本身。已有缓存会立即展示，同时后台刷新。网络或格式错误保留缓存；Coding 端点没有缓存时使用内置列表。模型详情会标明缓存或后备来源。认证、访问权限错误会单独报告。运行 **Kimi: Refresh Models** 可重试或发现新模型，修改 Key 或端点也会刷新模型。

下表是内置后备声明，不代表当前服务端目录或账号权限：

| 模型 ID | 显示名称 | 扩展上下文预算 | 可配置思考强度 |
| --- | --- | ---: | --- |
| `kimi-for-coding` | Kimi K2.8 Preview | 1,048,576 | 是 |
| `kimi-for-coding-highspeed` | Kimi K2.7 Code HighSpeed | 262,144 | 否 |
| `k3` | Kimi K3 | 1,048,576 | 是 |
| `k3-256k` | Kimi K3 256K | 262,144 | 是 |

这些是扩展侧声明，不是套餐权限检查。`k3` 声明 1M 上下文预算；如果套餐不允许 K3 1M，请选择 `k3-256k`。HighSpeed 和 K3 的访问权限也取决于订阅。

输入预算计算方式：

```text
maxInputTokens = contextWindow - configured maxOutputTokens
```

默认输出预算为 32,768 时，256K 模型的输入预算为 229,376，1M 模型为 1,015,808。发现更小的上下文时，输出保留量会限制在上下文大小以下，保证输入预算为正。调用方请求更小的输出上限时，扩展使用更小值，不会超过配置的输出预算。

输出设置范围是扩展的策略，不保证每个模型接受 65,536 输出 Token。Token 计数是近似值，因此接近上下文上限时仍可能被服务端拒绝。

每次请求的实际用量与估算分开处理：流式请求设置 `stream_options.include_usage`，使用服务端最后一个有效快照的输入（`prompt_tokens`）、输出（`completion_tokens`）和总数。返回缓存、思考计数时也会保留；思考 Token 不会重复加到输出总数中，也不会把重复快照累加。缺失或无效用量会在 **Kimi** 输出通道标为不可用，不会用估算替代。

用量通过带有 Copilot 内部 `usage` MIME 类型的 `LanguageModelDataPart` 传递，与其[扩展端点实现](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/platform/endpoint/vscode-node/extChatEndpoint.ts)对应。这不是稳定公开 API，原生 Token 显示取决于安装的 VS Code / Copilot 版本。输出通道也记录输入、输出和总数。这些请求用量独立于状态栏中的账号额度。

## 设置

以下设置均为应用范围。

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `kimi.endpoint` | `kimiCode` | 可选 `kimiCode`、`kimiCodeCN`、`moonshot`、`moonshotCN`、`custom`。 |
| `kimi.apiBaseUrl` | `https://api.kimi.ai/coding/v1` | 仅在 `custom` 时使用，不要追加 `/chat/completions`。 |
| `kimi.maxOutputTokens` | `32768` | 1 到 65536 的整数，保留输出空间并限制聊天输出。 |
| `kimi.reasoningEffort` | `default` | `default`、`low`、`high`、`max`；默认不发送 `reasoning_effort`，使用服务端默认值。 |
| `kimi.sendDeviceInfo` | `false` | 开启后发送主机名、设备/系统信息和随机会话设备 ID。 |
| `kimi.showUsageStatusBar` | `true` | 显示五小时和每周用量；关闭后停止额度轮询。 |

支持的模型会展示 **Thinking Effort** 菜单，选项和具体默认值来自服务端。扩展理解 None、Minimal、Low、Medium、High、Xhigh、Max，但只展示模型实际支持的选项。Copilot CLI / Agent Host 会重建为 **Thinking Level** 菜单，并过滤 `default` 等自定义值。旧选择仍会生效，不支持的选择会在发请求前给出错误。声明始终思考的模型不能关闭思考。

没有请求级思考强度选择时，`kimi.reasoningEffort` 作为后备；其中 `default` 仍然省略 `reasoning_effort`。请求的 `modelOptions.reasoningEffort` 优先于模型选择器值。只有启用思考时才应用强度；HighSpeed 不展示该菜单，也不发送强度参数。

模型选择器集成使用运行时非公开的 `configurationSchema` 和 `modelConfiguration` 字段。升级 VS Code 后应检查菜单及实际请求值。更新 VSIX 后，如果旧聊天仍展示旧菜单，请重载窗口，并在新聊天中重新选择模型。

用户设置示例：

```json
{
    "kimi.endpoint": "kimiCode",
    "kimi.maxOutputTokens": 32768,
    "kimi.reasoningEffort": "high"
}
```

### API 端点

| 选项 | 基础 URL | 状态 |
| --- | --- | --- |
| `kimiCode` | `https://api.kimi.ai/coding/v1` | Kimi Code 海外 |
| `kimiCodeCN` | `https://api.kimi.com/coding/v1` | Kimi Code 中国 |
| `moonshot` | `https://api.moonshot.ai/v1` | 尚未实现完整开放平台集成 |
| `moonshotCN` | `https://api.moonshot.cn/v1` | 尚未实现完整开放平台集成 |
| `custom` | `kimi.apiBaseUrl` 的值 | 需兼容本扩展的请求格式及模型 ID |

Moonshot 选项只修改 URL，不会适配模型目录或凭据。订阅访问请使用 Kimi Code 端点。

自定义端点示例：

```json
{
    "kimi.endpoint": "custom",
    "kimi.apiBaseUrl": "https://api.kimi.ai/coding/v1"
}
```

切换预设不会覆盖保存的自定义 URL。以前只配置 `kimi.apiBaseUrl` 的用户，现在需要选择 `custom` 才会使用该值。

## 命令与一键诊断

打开命令面板，搜索：

- **Kimi: Diagnose Current Configuration**：诊断当前已加载配置。
- **Kimi: Test Connection**：兼容旧入口，运行同一诊断流程。
- **Kimi: Refresh Models**：刷新模型。
- **Kimi: Refresh Usage**：刷新额度。
- **Kimi: Show Usage Actions**：打开额度操作菜单。
- **Kimi Code: Set API Endpoint to Global (kimi.ai)**：切换海外端点。
- **Kimi Code: Set API Endpoint to China (kimi.com)**：切换中国端点。
- **Kimi: Set Custom API Endpoint**：设置自定义端点。

也保留了两个 Moonshot 端点切换命令，但不提供完整开放平台支持。

### 诊断步骤

**Kimi: Diagnose Current Configuration** 复用 VS Code 已提供给扩展的 Key。**Kimi: Test Connection** 是同一流程的兼容别名，不再要求单独输入测试密钥。

1. 运行命令。如果没有已加载的 Key，按照提示打开 Chat → **Manage Language Models** 配置 Kimi，再重新运行。窗口重载后，命令会先让 VS Code 枚举已配置的 Kimi 模型。它不会读取 `.env`、弹出密钥输入框或保存第二份密钥。
2. 命令实时查询 `/models`，然后让你选择要检查的兼容模型。发现失败时，可使用已经加载的缓存/后备模型继续检查响应，但模型发现仍显示 **FAIL**。服务端成功返回空目录时，不会用后备模型替换。
3. 对所选模型分别发送一次普通请求和一次流式请求，使用当前端点、已加载 Key 和 **Kimi 全局思考设置**。命令不会读取当前 Chat 的模型或单独思考强度覆盖值，需要明确选择目标模型。多个账号并存时，与状态栏一样，诊断使用最近一次被准备的提供商配置。
4. 在 **Kimi** 输出通道查看每一步的 **PASS（通过）**、**WARN（警告）**、**FAIL（失败）** 或 **CANCELLED（取消）**。仅 HTTP 成功不算通过，还必须收到文本或思考内容及结束原因。达到诊断输出上限时显示警告；全局思考强度不受所选模型支持时，在发送聊天请求前失败。
5. 点击结束通知中的 **Copy Sanitized Report** 复制脱敏报告。报告包含版本、端点、模型、请求设置、响应耗时和各阶段结果，不包含 API Key、URL 用户信息/查询参数/片段、任意服务端错误正文、提示词及生成内容。自定义端点的域名或路径可能包含内部信息，请在分享前检查报告。

模型发现超时为 10 秒，每个聊天检查超时为 60 秒，覆盖连接建立和响应正文读取。可在进度通知中取消。重复运行命令会复用正在进行的同一次诊断。每次测试的输出上限为 `min(1024, 配置后的模型输出预算)`；思考也使用这部分预算，因此预算过小可能出现截断警告。不会发送或修改工作区文件及聊天历史。测试消耗额度，不会自动重试。

诊断验证基本模型访问和响应传输，不验证图片、工具执行、多轮思考历史，也不验证账号是否拥有声明的最大上下文权限。

需要更完整验证时，新建聊天并选择有权限的模型，检查文本回复，再让 Agent 读取一个测试文件而不修改它。开发时可检查模型 ID、端点、输出上限和思考强度是否按预期发送。

## 账号额度状态栏

VS Code 提供配置好的 Key 后，状态栏显示额度图标和类似 `Kimi · 5h 32% · 7d 68%` 的信息。两个数字都表示**账号订阅额度的已用百分比**，不是所选模型或当前聊天的 Token 消耗。切换到其他聊天模型后仍保持显示。

英文悬浮卡片按额度窗口展示已用比例、十段进度指示和重置倒计时，并显示本地重置时间及时区。倒计时和更新时长在刷新时重新计算，不会持续跳动。底部显示最后成功更新时间，并提供 **Refresh** 和 **Open Console**。点击状态栏打开相同操作菜单。

额度从 `<baseUrl>/usages` 获取，立即刷新并每 60 秒轮询一次，独立超时 10 秒，不重叠请求，不阻塞或取消聊天。刷新时显示旋转图标。失败后保留旧值，显示警告图标和 **Stale** 标记；没有成功结果时显示额度不可用。缺失窗口显示 `—`，不会伪造为零。进度指示最多十段，超过 100% 的实际百分比仍会展示；已过期的重置时间标为等待更新。失败记录到输出通道，不自动弹出错误窗口。

修改凭据/端点会清空额度并取消旧查询，隐藏状态栏停止轮询。窗口重载后等待 VS Code 提供凭据，不读取 `.env` 或持久化另一份 Key。明确清除 Key 的提供商回调会隐藏状态栏，不带配置的基础扫描会被忽略。多个 Kimi 配置并存时，状态栏跟随最近一次被准备的配置。自定义和 Moonshot 端点可能没有该订阅额度 API，这不影响聊天。

运行 `pnpm test` 检查解析、缓存、账号隔离、刷新/超时、诊断及聊天回归。开发 `.env` 文件不进入 Git 和 VSIX 包。

## 思考与工具调用

扩展用 `LanguageModelThinkingPart` 传递 `reasoning_content`，用 `LanguageModelTextPart` 传递答案文本，不会把思考包成 HTML `<details>`。

VS Code 在助手工具调用历史中返回思考片段时，扩展将它们合并并作为 `reasoning_content` 回传。启用思考但没有这些片段时，发送 `reasoning_content: ""`，不插入占位文本。原生思考组件不可用时，跳过思考显示，但仍输出普通答案。

工具调用参数从流式增量中累积，然后交给 VS Code 执行。发布前应在目标 VS Code 版本中验证流式及历史处理。

## 请求行为与发送的数据

客户端使用兼容 OpenAI Chat Completions 的 `<baseUrl>/chat/completions`，当前不使用 Responses API。

聊天请求包含 `model`、`messages`、`stream`、`thinking` 和作为 `max_completion_tokens` 的输出预算。支持的思考设置发送为 `reasoning_effort`；提供工具定义和工具选择时一并发送。任务 ID 可作为 `prompt_cache_key` 转发。API 客户端也支持可选 `top_p` 和 `stop`，聊天提供商当前不设置它们，也不设置 `temperature` 或 `safety_identifier`。

VS Code 传入的聊天内容、图片、支持的文本/JSON 附件及工具结果会发送到配置的端点。图片编码成 base64 `image_url`。不支持的二进制附件（包括视频）会替换为省略提示。诊断只发送内置小型测试提示，不发送工作区或聊天内容。

认证使用 `Authorization: Bearer <apiKey>`。客户端标识为 `kimi-lm-provider/<extension-version> (VSCode/<vscode-version>; dreamyfishmt.dreamyfishmt-kimi-code)`，扩展版本和 ID 来自 `package.json`，VS Code 版本来自运行环境。`X-Msh-Platform` 为 `kimi-lm-provider`，`X-Msh-Version` 为扩展版本。

默认不读取主机名或系统/设备详情，不生成设备 ID，也不发送 `X-Msh-Device-Name`、`X-Msh-Device-Model`、`X-Msh-Device-Id`、`X-Msh-Os-Version`。设置 `kimi.sendDeviceInfo` 为 `true` 后开启这四个头；随机 ID 在首次使用时生成，仅保留在当前加载的模块实例中。这些标识描述本独立提供商，不冒充 GitHub Copilot 官方客户端。服务端是否接受需通过实际请求验证。

## 排查问题

- **没有模型**：在 Kimi 提供商中配置 API Key，确认扩展已激活。
- **诊断连接问题**：运行 **Kimi: Diagnose Current Configuration**，选择目标模型，在输出通道查看失败阶段。反馈问题时使用 **Copy Sanitized Report**。使用缓存/后备模型时，模型发现失败与响应检查成功可以同时出现。
- **扩展无法加载**：检查 VS Code 最低版本，并在安装扩展后重载窗口。
- **HTTP 401**：同时检查 Key 和服务端信息，可能是模型或上下文套餐权限不足。当前普通聊天错误前缀仍将全部 401 标为认证失败；诊断会提示同时检查 Key 和权限。
- **HTTP 403**：可能是额度耗尽、并发限制或其他拒绝，查看服务端详情和账号控制台。
- **HTTP 429**：可能是限流或服务过载。当前普通聊天提示较泛化，等待后重试。
- **上下文超限**：检查模型、套餐权限和输出预算，Token 估算是近似值。
- **诊断显示 WARN**：小型诊断输出预算可能被思考耗尽。检查输出预算，尝试更快模型或受支持的较低思考强度。

服务端诊断请参考 [Kimi Code 错误说明](https://www.kimi.com/code/docs/en/kimi-code/error-reference.html)。

## 打包与 Marketplace 准备

生成本地测试 VSIX：

```sh
pnpm run compile
pnpm dlx @vscode/vsce package --no-dependencies
```

当前没有生产 npm 依赖，运行时只使用 VS Code、Node.js 和编译后的本地模块，因此可用 `--no-dependencies`。新增生产依赖后需重新评估该选项。打包也会执行 `vscode:prepublish`。

发布到 Marketplace 前：

1. 在普通安装环境验证思考显示和历史处理。
2. 在目标 VS Code 版本验证模型访问、流式、图片、工具调用及错误提示。
3. 确认拥有 Marketplace 发布者 ID `dreamyfishmt`，GitHub 用户名并不自动注册发布者。
4. 确定版本，检查 VSIX 中的 README、许可证、图标和编译入口。

完成后按照[官方发布指南](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)操作。上述构建、打包命令不会发布到 Marketplace。

## 自动发布 GitHub Releases

[Release VSIX 工作流](.github/workflows/release.yml)在推送发布标签时运行，仅推送分支不会发布。标签可以指向任何分支（包括 `nightly`）上的提交：标签名决定渠道，标签指向的提交提供源码及工作流。

| 标签 | GitHub Release | VSIX |
| --- | --- | --- |
| `vX.Y.Z` | 正式版，标为 Latest | `dreamyfishmt-kimi-code-X.Y.Z-stable.vsix` |
| `nightly-vX.Y.Z` | 预发布，不标为 Latest | `dreamyfishmt-kimi-code-X.Y.Z-nightly.vsix`，标为预发布包 |

标签版本必须与 `package.json` 完全一致。例如当前版本为 `0.5.10`，可在希望发布的提交上选择一个渠道：

```sh
# 正式版
git tag v0.5.10
git push origin v0.5.10

# Nightly
git tag nightly-v0.5.10
git push origin nightly-v0.5.10
```

创建标签前先提交工作流和需要发布的源码。每次新发布使用新标签；修改版本时同步更新 `package.json` 和 `package-lock.json`。工作流校验版本，用 `npm ci` 安装依赖，编译并运行测试，再用固定版本的 `vsce` 打包。检查失败会阻止发布。重新运行成功标签的工作流会更新已有 Release 并替换 VSIX 附件。

工作流使用 GitHub 内置 `GITHUB_TOKEN` 和 `contents: write`，不需要个人访问令牌或 Marketplace 密钥。需要启用仓库 GitHub Actions，并允许工作流写权限。GitHub 发布渠道不会改变前述 VS Code 版本要求。

## 许可证与致谢

MIT，见 [LICENSE](LICENSE)。

感谢 [zelosleone/kimi-lm-copilot-provider](https://github.com/zelosleone/kimi-lm-copilot-provider) 提供原始项目。
