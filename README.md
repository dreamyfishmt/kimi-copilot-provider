# Kimi Language Model Provider for Copilot

Use your Kimi Code subscription in VS Code Chat and Agent mode through a custom language model provider. The extension connects directly to the Kimi Code API using your own API key.

Extension ID: `dreamyfishmt.kimi-lm-provider`. This is not an official Kimi or GitHub extension.

## Current release status

The current source declares the proposed VS Code API `languageModelThinkingPart`. Local debugging has been exercised, but this is not yet a standard Marketplace-ready build. VS Code's [proposed API guidance](https://code.visualstudio.com/api/advanced-topics/using-proposed-api) says extensions using proposed APIs should not be published to the Marketplace.

Resolve this dependency and verify normal installed-extension behavior before publishing. Removing the manifest declaration alone does not preserve thinking display or history handling.

## Features

- Automatic model discovery, with account/endpoint-scoped caching and manual refresh.
- Status bar showing five-hour and weekly account usage, refreshed every 60 seconds independently of chat.
- Streaming text responses and Agent tool calls.
- Server-reported input/output token usage forwarded to Copilot Chat.
- Native thinking parts when the required VS Code API is available.
- Image attachments, plus text/plain and JSON data attachments.
- Configurable output token budget and reasoning effort.
- Kimi Code endpoints for overseas and China access, plus a custom base URL.

This extension provides chat models; it does not replace Copilot's inline code completion model. Video attachments are not implemented, even when the selected Kimi model supports video.

## Requirements

- VS Code 1.120.0 or later, as declared in the manifest.
- A VS Code environment supporting the declared thinking API. VS Code Insiders is the documented environment for proposed API development.
- Chat/Agent functionality available in the development window.
- An active Kimi Code subscription with access to the selected model.
- An API key from the [Kimi Code console](https://www.kimi.com/code/console).
- Node.js and pnpm for building from source.

Kimi Code subscription keys and Kimi Open Platform keys are not interchangeable. See the [Kimi Code model documentation](https://www.kimi.com/code/docs/en/kimi-code/models.html) for current model and subscription availability.

## Run from source

1. Open this repository in VS Code.
2. Install dependencies and compile:

   ```sh
   pnpm install
   pnpm run compile
   ```

3. Open Run and Debug, select **Run Kimi ext**, and press **F5**.
4. Continue in the new **Extension Development Host** window.

The included launch configuration enables proposed APIs for `dreamyfishmt.kimi-lm-provider`. It does not automatically compile before launch. After changing TypeScript code, compile again and restart debugging. Alternatively, run `pnpm run watch` during development.

## Configure the provider

1. In the development window, open Settings and search for `@ext:dreamyfishmt.kimi-lm-provider`.
2. Choose **Kimi Code** for overseas access or **Kimi Code CN** for China access under **Kimi: Endpoint**.
3. Open Chat, then **Manage Language Models** from the model picker.
4. Add the **Kimi** provider and enter your Kimi Code API key. The field is declared as a secret in the provider configuration.
5. Select a Kimi model and start a new chat.

The provider returns no models until an API key has been configured. Configure the key through the provider UI, not in the repository or the example settings below.

## Models and context budgets

Models are fetched from `<baseUrl>/models` when VS Code supplies the configured API key. The server determines model IDs, display names, context lengths, image/tool capabilities, thinking support, and reasoning effort choices/defaults. Only Chat Completions-compatible models are advertised; models declaring other protocols are skipped. Missing metadata for known models uses the compatibility information below; unknown models use conservative capabilities and a 32K context fallback.

A successful response replaces the catalog, including when it is empty. Public model metadata is cached in VS Code extension storage, isolated by a SHA-256 fingerprint of the endpoint and key; the key itself is not stored there. Cached models appear immediately while a background refresh runs. Network/format errors retain a cache, or use the built-in list below for Coding endpoints when no cache exists. The model details identify cached/fallback data. Authentication/access errors are reported separately. Use **Kimi: Refresh Models** to retry or discover newly available models. Changing the key or endpoint also refreshes discovery.

The following table describes the built-in fallback, not the current server catalog:

| Model ID | Display name | Extension context budget | Configurable reasoning effort |
| --- | --- | ---: | --- |
| `kimi-for-coding` | Kimi K2.8 Preview | 1,048,576 | Yes |
| `kimi-for-coding-highspeed` | Kimi K2.7 Code HighSpeed | 262,144 | No |
| `k3` | Kimi K3 | 1,048,576 | Yes |
| `k3-256k` | Kimi K3 256K | 262,144 | Yes |

These are extension-side declarations, not account entitlement checks. The `k3` entry advertises a 1M context budget; select `k3-256k` if your subscription does not permit K3 1M. HighSpeed and K3 access also depend on your subscription.

The input budget is calculated as:

```text
maxInputTokens = contextWindow - configured maxOutputTokens
```

With the default output budget of 32,768, the input budget is 229,376 for 256K models and 1,015,808 for 1M models. For smaller discovered contexts, the output reservation is capped below the context size to keep a positive input budget. If the caller requests a smaller output limit, the extension uses that smaller value; it never raises the request above the configured output budget.

The output setting's allowed range is an extension policy, not a guarantee that every model accepts 65,536 output tokens. Token counting is approximate, so requests near the context limit can still exceed server limits.

Actual request usage is separate from those estimates: streaming requests set `stream_options.include_usage`, and the final valid server usage snapshot supplies input (`prompt_tokens`), output (`completion_tokens`), and total counts. Cache and reasoning counts are retained when present; reasoning is not added again to the output total. Repeated usage snapshots are not summed. Missing or invalid usage is reported as unavailable in the **Kimi** output channel, without substituting estimated counts.

Usage is forwarded as a `LanguageModelDataPart` with Copilot's internal `usage` MIME type, as consumed by its [extension endpoint implementation](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/platform/endpoint/vscode-node/extChatEndpoint.ts). This is not a stable public usage API, so native token display depends on the installed VS Code/Copilot version. The **Kimi** output channel also records the returned input/output/total counts. These per-request counts are independent of the account quota status bar.

## Settings

All settings below use application scope.

| Setting | Default | Behavior |
| --- | --- | --- |
| `kimi.endpoint` | `kimiCode` | Selects `kimiCode`, `kimiCodeCN`, `moonshot`, `moonshotCN`, or `custom`. |
| `kimi.apiBaseUrl` | `https://api.kimi.ai/coding/v1` | Used only with `custom`. Do not append `/chat/completions`. |
| `kimi.maxOutputTokens` | `32768` | Integer from 1 to 65536. Reserves output space and caps chat output. |
| `kimi.reasoningEffort` | `default` | `default`, `low`, `high`, or `max`. Default omits `reasoning_effort` and uses the server default. |
| `kimi.sendDeviceInfo` | `false` | Opt in to sending hostname, device/OS details, and a random session device ID to the configured API endpoint. |
| `kimi.showUsageStatusBar` | `true` | Show five-hour and weekly usage. Disabling it also stops usage polling. |

Supported models expose a **Thinking Effort** menu using the server's advertised levels and concrete default. The extension understands None, Minimal, Low, Medium, High, Xhigh, and Max, but only advertises levels supported by that model. Copilot CLI / Agent Host rebuilds this menu as **Thinking Level** and filters out custom values such as `default`. Previously saved selections remain in effect; unsupported selections produce an actionable error before sending a request. Models declaring always-on thinking cannot have it disabled.

The global `kimi.reasoningEffort` setting is a fallback when the request contains no effort selection; its `default` value still omits `reasoning_effort`. Request-level `modelOptions.reasoningEffort` overrides the model picker value. Effort is applied only when thinking is enabled and is omitted for HighSpeed, which does not expose this menu.

The picker integration uses the current runtime's non-public `configurationSchema` and `modelConfiguration` fields without adding a `chatProvider` proposal declaration. Verify menu display and request values after VS Code upgrades. After installing an updated VSIX, reload the window and select the model in a new chat if an existing chat still shows the old menu.

Example user settings:

```json
{
    "kimi.endpoint": "kimiCode",
    "kimi.maxOutputTokens": 32768,
    "kimi.reasoningEffort": "high"
}
```

### Endpoints

| Selection | Base URL | Status |
| --- | --- | --- |
| `kimiCode` | `https://api.kimi.ai/coding/v1` | Kimi Code overseas |
| `kimiCodeCN` | `https://api.kimi.com/coding/v1` | Kimi Code China |
| `moonshot` | `https://api.moonshot.ai/v1` | Open Platform integration not implemented |
| `moonshotCN` | `https://api.moonshot.cn/v1` | Open Platform integration not implemented |
| `custom` | Value of `kimi.apiBaseUrl` | Must support this extension's request format and model IDs |

The Moonshot selections change the URL only; they do not adapt the model catalog or credentials. Use a Kimi Code endpoint for subscription access.

To use a custom endpoint:

```json
{
    "kimi.endpoint": "custom",
    "kimi.apiBaseUrl": "https://api.kimi.ai/coding/v1"
}
```

Changing a preset preserves the stored custom URL. Existing users who previously set only `kimi.apiBaseUrl` must now select `custom` to use that value.

## Commands and connection testing

Open the Command Palette and search for:

- **Kimi: Test Connection**
- **Kimi: Refresh Models**
- **Kimi: Refresh Usage**
- **Kimi: Show Usage Actions**
- **Kimi Code: Set API Endpoint to Global (kimi.ai)**
- **Kimi Code: Set API Endpoint to China (kimi.com)**
- **Kimi: Set Custom API Endpoint**

The two Moonshot endpoint commands are also present but do not provide complete Open Platform support.

**Test Connection** asks for a key for that test only; it does not save provider credentials. The current implementation sends a non-streaming `Ping` to `kimi-for-coding` with an output limit of one token and thinking disabled. Success checks basic request connectivity only. It does not validate the selected chat model, streaming, reasoning effort, or multi-turn Agent tools.

For a fuller check, start a new chat with an entitled model, verify a text response, then ask Agent mode to read a test file without modifying it. During development, inspect the outgoing request to confirm the model ID, endpoint, output limit, and reasoning effort.

## Account usage status bar

After VS Code supplies a configured provider key, the status bar shows a usage icon followed by `Kimi · 5h 32% · 7d 68%`. Both values mean **used percentage of the account subscription quota**, not tokens consumed by the selected model or current chat. It stays visible when another chat model is selected. The English hover card groups each quota window with its used percentage, a ten-segment progress indicator, and a reset countdown with the local reset date/time and timezone. Countdown and update-age labels are recomputed on refresh, rather than ticking continuously. The footer shows the last successful update and provides **Refresh** and **Open Console** links. Clicking the status bar opens the same actions in a menu.

Usage is read from `<baseUrl>/usages` immediately and every 60 seconds, with a separate 10-second timeout and no overlapping queries. It never blocks or cancels chat. A spinning icon indicates refreshes. Failed refreshes keep previous values with a warning icon and **Stale** label in the hover; without a successful result, the item says usage is unavailable. Missing windows display `—`, never a fabricated zero. The progress indicator is bounded to ten segments; reported percentages above 100% remain visible, and a passed reset timestamp is labeled as awaiting an update. Failures go to the **Kimi** output channel without automatic error popups.

Changing credentials/endpoints clears quota data and cancels old quota requests. Hiding the item stops polling. On reload it waits for VS Code to supply credentials; it does not read `.env` or persist a second copy of the API key. A provider callback explicitly clearing its key hides the item; an unconfigured vendor scan is ignored. With multiple Kimi provider configurations, the status bar follows the most recently prepared configuration. Custom and Moonshot endpoints may not implement this subscription quota API; that does not affect chat.

Run `pnpm test` for parser, cache, account isolation, refresh/timeout, and chat regression tests. Development `.env` files are excluded from Git and VSIX packages.

## Thinking and tool calls

The extension emits `LanguageModelThinkingPart` for `reasoning_content` and `LanguageModelTextPart` for answer text. It does not wrap reasoning in HTML `<details>` blocks.

When VS Code returns thinking parts alongside an assistant tool call, the extension joins those parts and sends them back as `reasoning_content`. If none are present while thinking is enabled, it currently inserts `(reasoning not preserved in chat history)`. This placeholder is not the original reasoning text. If the proposed thinking API is unavailable, reasoning display is skipped while ordinary answer text is still emitted.

Tool call arguments are accumulated from streamed deltas and reported to VS Code for execution. Streaming and history handling should be tested in the intended VS Code version before release.

## Request behavior and data sent

The client uses the OpenAI-compatible Chat Completions endpoint at `<baseUrl>/chat/completions`. It does not currently use Responses API.

Chat requests include `model`, `messages`, `stream`, `thinking`, and the output budget as `max_completion_tokens`. Supported reasoning settings become `reasoning_effort`; tool definitions and tool choice are included when supplied. A task ID can be forwarded as `prompt_cache_key`. The API client also supports optional `top_p` and `stop`; the chat provider does not currently set them. It does not set `temperature` or `safety_identifier`.

Conversation content, attached images, supported text/JSON attachments, and tool results passed by VS Code are sent to the configured endpoint. Images are encoded as base64 `image_url` content. Unsupported binary attachments, including video, are replaced with an omission notice.

Authentication uses `Authorization: Bearer <apiKey>`. The client identifies this extension as `kimi-lm-provider/<extension-version> (VSCode/<vscode-version>; dreamyfishmt.kimi-lm-provider)`. The extension version and ID are read from `package.json`; the VS Code version comes from the running host. `X-Msh-Platform` is `kimi-lm-provider`, and `X-Msh-Version` is the extension version. By default, the extension does not read hostname or OS/device details, generate a device ID, or send `X-Msh-Device-Name`, `X-Msh-Device-Model`, `X-Msh-Device-Id`, or `X-Msh-Os-Version`. Setting `kimi.sendDeviceInfo` to `true` enables these four headers; the random ID is generated on first use and retained only for the loaded module instance. These client identifiers describe this independent provider, not an official GitHub Copilot client. Server acceptance of these identifiers must be verified with a live request.

## Troubleshooting

- **No models listed:** Configure the API key under the Kimi provider and check that the extension activated.
- **Extension cannot load:** Check the VS Code minimum version and proposed API availability. Development success does not establish normal Marketplace installation compatibility.
- **HTTP 401:** Check the server response as well as the key. Kimi can use 401 for model/context entitlement failures. The current chat error prefix still labels all 401 responses as authentication failures.
- **HTTP 403:** May indicate exhausted quota, concurrency limits, or another rejection. Inspect the response detail.
- **HTTP 429:** May indicate rate limiting or overload. The current chat error message is generic.
- **Context limit errors:** Check the model, subscription entitlement, and output budget; token estimates are approximate.

See the [Kimi Code error reference](https://www.kimi.com/code/docs/en/kimi-code/error-reference.html) for server-specific diagnostics.

## Packaging and Marketplace preparation

To create a local VSIX for testing:

```sh
pnpm run compile
pnpm dlx @vscode/vsce package --no-dependencies
```

`--no-dependencies` is appropriate for this source tree because it has no production npm dependencies; runtime imports use VS Code, Node.js, and compiled local modules. Revisit this flag if production dependencies are added. Packaging also runs `vscode:prepublish`.

A local VSIX does not remove the proposed API requirement. See [sharing extensions using proposed APIs](https://code.visualstudio.com/api/advanced-topics/using-proposed-api#sharing-extensions-using-the-proposed-api) for installation and launch requirements.

Before a Marketplace release:

1. Resolve the proposed thinking API dependency and verify thinking/history behavior in a normal installed extension.
2. Verify model access, streaming, images, tool calls, and failure messages in the target VS Code version.
3. Confirm ownership of the Marketplace publisher ID `dreamyfishmt`; a GitHub username alone does not register a Marketplace publisher.
4. Choose the release version and review the VSIX contents, including README, license, icon, and compiled entry point.

Follow the official [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) after those checks. No Marketplace publication is performed by the build or package commands above.

## Automated GitHub Releases

The [Release VSIX workflow](.github/workflows/release.yml) runs when a release tag is pushed. Branch pushes alone do not publish a release. Tags can point to commits on any branch, including `nightly`: the tag name selects the release channel, and the tagged commit supplies the source and workflow.

| Tag | GitHub Release | VSIX |
| --- | --- | --- |
| `vX.Y.Z` | Stable release, marked Latest | `kimi-lm-provider-X.Y.Z-stable.vsix` |
| `nightly-vX.Y.Z` | Prerelease, never marked Latest | `kimi-lm-provider-X.Y.Z-nightly.vsix`, marked as a prerelease package |

The tag version must exactly match `package.json`. For example, with the current version `0.5.2`, publish either channel from the commit you want to release:

```sh
# Stable
git tag v0.5.2
git push origin v0.5.2

# Nightly
git tag nightly-v0.5.2
git push origin nightly-v0.5.2
```

Commit the workflow and all intended source changes before creating a tag. Each new release needs a new tag; update `package.json` and `package-lock.json` together when changing the version. The workflow validates the version, installs dependencies with `npm ci`, compiles and runs tests, then packages the extension with a pinned version of `vsce`. A failed check prevents publication. Rerunning a successful tag workflow updates the existing release and replaces its VSIX asset.

The workflow uses GitHub's built-in `GITHUB_TOKEN` with `contents: write`; no personal access token or Marketplace secret is needed. Enable GitHub Actions in the repository and ensure repository/organization policy permits the workflow's write permission. GitHub release channels do not change this extension's VS Code version or proposed API requirements described above.

## License and acknowledgements

MIT. See [LICENSE](LICENSE).

Thanks to [zelosleone/kimi-lm-copilot-provider](https://github.com/zelosleone/kimi-lm-copilot-provider) for the original project.
