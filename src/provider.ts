import * as vscode from "vscode";
import {
	KimiApiClient,
	KimiApiError,
	summarizeErrorResponse,
	type KimiMessage,
	type KimiTool,
} from "./api.js";
import { getApiBaseUrl, getReasoningEffort } from "./config.js";
import { KIMI_MODELS, toLanguageModelChatInformation, getModelTokenBudget, type KimiModelInfo } from "./models.js";
import { assistantToolCallThinkingPayload } from "./reasoning.js";
import { accountId, ModelCatalog } from "./catalog.js";
import type { Account } from "./usage.js";
import { parseTokenUsage, type TokenUsage } from "./tokenUsage.js";

// Compatibility fields used by the current VS Code model picker (non-public API).
type KimiResponseOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: Readonly<Record<string, unknown>>;
	readonly configuration?: Readonly<Record<string, unknown>>;
};

interface ToolCallBuilder {
	id: string;
	name: string;
	arguments: string;
}

function getObjectProperty(
	source: unknown,
	key: string,
): unknown {
	if (!source || typeof source !== "object") {
		return undefined;
	}

	return (source as Record<string, unknown>)[key];
}

function getApiKey(
	options: unknown,
): string | undefined {
	// VS Code 1.120+ passes provider config as modelConfiguration
	const modelConfig = getObjectProperty(options, "modelConfiguration");
	const fromModelConfig = getStringProperty(modelConfig, "apiKey");
	if (fromModelConfig) {
		return fromModelConfig;
	}

	// VS Code <=1.119 passes provider config as configuration
	const configuration = getObjectProperty(options, "configuration");
	const fromLegacyConfig = getStringProperty(configuration, "apiKey");
	if (fromLegacyConfig) {
		return fromLegacyConfig;
	}

	return undefined;
}

function getStringProperty(
	source: unknown,
	key: string,
): string | undefined {
	if (!source || typeof source !== "object") {
		return undefined;
	}
	const value = (source as Record<string, unknown>)[key];
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function getPromptCacheKey(
	options: vscode.ProvideLanguageModelChatResponseOptions,
): string | undefined {
	const metadata = getObjectProperty(options, "metadata");
	const taskId = getObjectProperty(metadata, "taskId");
	if (typeof taskId !== "string") {
		return undefined;
	}

	const normalized = taskId.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function getToolCallBuilder(
	builders: Map<number, ToolCallBuilder>,
	index: number,
): ToolCallBuilder {
	const existing = builders.get(index);
	if (existing) {
		return existing;
	}

	const created: ToolCallBuilder = { id: "", name: "", arguments: "" };
	builders.set(index, created);
	return created;
}

function parseToolCallArguments(raw: string): Record<string, unknown> {
	const s = raw.trim() || "{}";
	try {
		const parsed: unknown = JSON.parse(s);
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return { _nonObjectToolArguments: parsed };
	} catch {
		return {
			_invalidToolArgumentsJson: true,
			_rawArguments: raw,
		};
	}
}

function emitToolCalls(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	builders: Map<number, ToolCallBuilder>,
): void {
	for (const [, builder] of builders) {
		if (!builder.id || !builder.name) continue;

		const args = parseToolCallArguments(builder.arguments);
		progress.report(
			new vscode.LanguageModelToolCallPart(builder.id, builder.name, args),
		);
	}
	builders.clear();
}

function mapKimiApiError(error: KimiApiError): Error {
	const detail = error.response
		? ` Response: ${summarizeErrorResponse(error.response)}`
		: "";

	switch (error.statusCode) {
		case 0:
			return new Error(`${error.message}${detail}`);
		case 401:
			return new Error(
				`Authentication failed (401). Check your API key from kimi.com/code/console.${detail}`,
			);
		case 403:
			return new Error(
				`Forbidden (403). The API rejected the request.${detail}`,
			);
		case 429:
			return new Error("Rate limit exceeded. Please wait and try again.");
		default:
			return new Error(`Kimi API error ${error.statusCode}: ${error.message}${detail}`);
	}
}

export class KimiChatProvider implements vscode.LanguageModelChatProvider {
	private apiKey: string | undefined;
	private readonly catalogs = new Map<string, ModelCatalog>();
	private bindings = new WeakMap<vscode.LanguageModelChatInformation, ModelCatalog>();
	private activeCatalog: ModelCatalog | undefined;
	private readonly accountChangedEmitter = new vscode.EventEmitter<Account | undefined>();
	readonly onDidChangeAccount = this.accountChangedEmitter.event;
	constructor(private readonly storage?: vscode.Memento, private readonly log: (message: string) => void = () => {}) {}

	get account(): Account | undefined {
		return this.apiKey ? { apiKey: this.apiKey, baseUrl: getApiBaseUrl() } : undefined;
	}

	get diagnosticConfiguration(): { account: Account; models: readonly KimiModelInfo[] } | undefined {
		const account = this.account;
		if (!account) return undefined;
		return { account, models: [...this.catalogFor(account.apiKey).models] };
	}

	private catalogFor(key: string): ModelCatalog {
		const baseUrl = getApiBaseUrl();
		const id = accountId(key, baseUrl);
		let catalog = this.catalogs.get(id);
		if (!catalog) {
			catalog = new ModelCatalog(key, baseUrl, this.storage, () => this.notifyModelsChanged(), this.log);
			this.catalogs.set(id, catalog);
		}
		return catalog;
	}

	configurationChanged(): void {
		if (this.apiKey) {
			this.activeCatalog = this.catalogFor(this.apiKey);
			void this.activeCatalog.refresh();
		}
		this.accountChangedEmitter.fire(this.account);
		this.notifyModelsChanged();
	}

	async refreshModels(): Promise<void> {
		if (!this.activeCatalog) {
			vscode.window.showInformationMessage("请先在模型选择器中配置 Kimi API Key。");
			return;
		}
		await this.activeCatalog.refresh();
		if (this.activeCatalog.error) vscode.window.showWarningMessage(`Kimi 模型刷新失败：${this.activeCatalog.error}`);
		else vscode.window.showInformationMessage(`Kimi：已获取 ${this.activeCatalog.models.length} 个兼容模型。`);
	}

	dispose(): void {
		this.apiKey = undefined;
		this.activeCatalog = undefined;
		this.bindings = new WeakMap();
		for (const catalog of this.catalogs.values()) catalog.dispose();
		this.catalogs.clear();
		this.modelsChangedEmitter.dispose();
		this.accountChangedEmitter.dispose();
	}
	private readonly modelsChangedEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.modelsChangedEmitter.event;

	notifyModelsChanged(): void {
		this.modelsChangedEmitter.fire();
	}

	async provideLanguageModelChatInformation(
		options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		const key = getApiKey(options);
		if (!key) {
			// No API key configured yet — return empty so VS Code doesn't
			// duplicate model entries during the base vendor scan.
			// Once the user sets an API key via the model picker, VS Code
			// will call this method again with the configuration present.
			// A vendor scan without configuration is not a credential deletion.
			if (getObjectProperty(options, "modelConfiguration") !== undefined || getObjectProperty(options, "configuration") !== undefined) {
				this.apiKey = undefined;
				this.activeCatalog = undefined;
				this.bindings = new WeakMap();
				for (const catalog of this.catalogs.values()) catalog.dispose();
				this.catalogs.clear();
				this.accountChangedEmitter.fire(undefined);
			}
			return [];
		}

		this.apiKey = key;
		const catalog = this.catalogFor(key);
		if (catalog !== this.activeCatalog) {
			this.activeCatalog = catalog;
			this.accountChangedEmitter.fire(this.account);
		}
		const models = await catalog.prepare();
		if (catalog.error && models.length === 0) throw new Error(`Kimi 模型列表不可用：${catalog.error}`);
		return models.map(model => {
			const source = catalog.source === "cache" ? "缓存" : catalog.source === "fallback" ? "内置后备" : undefined;
			const original = toLanguageModelChatInformation(model);
			const info = { ...original, detail: original.detail + (source || catalog.error ? ` · ${[source, catalog.error].filter(Boolean).join(" · ")}` : "") };
			this.bindings.set(info, catalog);
			return info;
		});
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const key = getApiKey(options);
		const boundCatalog = this.bindings.get(model);
		const requestKey = key ?? boundCatalog?.apiKey ?? this.apiKey;
		const catalog = requestKey ? this.catalogFor(requestKey) : undefined;
		if (!catalog || !this.apiKey) {
			throw new Error(
				"API key not configured. Configure it via the model picker.",
			);
		}

		const client = new KimiApiClient(catalog.apiKey);
		const modelDef = catalog.models.find((m) => m.id === model.id);
		if (!modelDef) {
			throw new Error(`Unknown Kimi model: ${model.id}`);
		}

		const budget = getModelTokenBudget(modelDef);
		const thinking = this.resolveThinkingEnabled(modelDef, options);
		const requestOptions = options as KimiResponseOptions;
		const selectedEffort =
			requestOptions.modelOptions?.reasoningEffort ??
			requestOptions.modelConfiguration?.reasoningEffort ??
			requestOptions.configuration?.reasoningEffort;
		const reasoningEffort = thinking && modelDef.supportsReasoningEffort
			? getReasoningEffort(selectedEffort)
			: undefined;
		if (reasoningEffort && !modelDef.reasoningEfforts?.includes(reasoningEffort)) {
			throw new Error(`Reasoning effort '${reasoningEffort}' is not supported by ${model.id}. Select a supported level.`);
		}
		const kimiMessages = this.convertMessages(messages, thinking);
		const kimiTools = this.convertTools(options.tools);

		const requestedMaxTokens = options.modelOptions?.maxTokens;

		if (
			requestedMaxTokens !== undefined &&
			(
				typeof requestedMaxTokens !== "number" ||
				!Number.isInteger(requestedMaxTokens) ||
				requestedMaxTokens <= 0
			)
		) {
			throw new Error("maxTokens must be a positive integer.");
		}
		const maxTokens =
    typeof requestedMaxTokens === "number"
        ? Math.min(requestedMaxTokens, budget.maxOutputTokens)
        : budget.maxOutputTokens;
		const promptCacheKey = getPromptCacheKey(options);
		const baseUrl = catalog.baseUrl;
		const requireSseDoneMarker = modelDef?.requireSseDoneMarker ?? true;

		try {
			const stream = client.streamChat(
				model.id,
				kimiMessages,
				baseUrl,
				{
					maxTokens,
					tools: kimiTools,
					thinking,
					reasoningEffort,
					promptCacheKey,
					toolMode: options.toolMode,
					requireSseDoneMarker,
				},
				token,
			);

			const toolCallBuilders = new Map<number, ToolCallBuilder>();
			let usage: TokenUsage | undefined;

			const reportThinkingPart = (text: string): void => {
				const thinkingPart = createThinkingPart(text);
				if (thinkingPart) {
					progress.report(thinkingPart);
				}
			};

			for await (const chunk of stream) {
				if (token.isCancellationRequested) break;
				// Usage is a cumulative snapshot, often in a final chunk with no choices.
				usage = parseTokenUsage(chunk.usage) ?? usage;

				for (const choice of chunk.choices ?? []) {
					const delta = choice.delta;

					if (delta.reasoning_content) {
						reportThinkingPart(delta.reasoning_content);
					}

					if (delta.content) {
						progress.report(new vscode.LanguageModelTextPart(delta.content));
					}

					if (delta.tool_calls) {
						for (const toolCall of delta.tool_calls) {
							const builder = getToolCallBuilder(toolCallBuilders, toolCall.index);

							if (toolCall.id) builder.id = toolCall.id;
							if (toolCall.function?.name) builder.name = toolCall.function.name;
							if (toolCall.function?.arguments) builder.arguments += toolCall.function.arguments;
						}
					}

					if (choice.finish_reason === "tool_calls") {
						emitToolCalls(progress, toolCallBuilders);
					}
				}
			}

			emitToolCalls(progress, toolCallBuilders);
			if (!token.isCancellationRequested) {
				if (usage) {
					// Copilot's extChatEndpoint consumes JSON DataParts with the internal
					// MIME type "usage". This is not yet a public token-usage API.
					progress.report(new vscode.LanguageModelDataPart(
						new TextEncoder().encode(JSON.stringify(usage)), "usage",
					));
					this.log(`Token usage: input=${usage.prompt_tokens}, output=${usage.completion_tokens}, total=${usage.total_tokens}`);
				} else {
					this.log("Token usage unavailable: the response did not include valid usage counts.");
				}
			}
		} catch (error) {
			if (!(error instanceof KimiApiError)) throw error;
			throw mapKimiApiError(error);
		}
	}

	provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Thenable<number> {
		if (typeof text === "string") {
			return Promise.resolve(Math.ceil(text.length / 4));
		}

		let totalChars = 0;
		for (const part of text.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				totalChars += part.value.length;
			} else if (part instanceof vscode.LanguageModelDataPart) {
				totalChars += part.data.length;
			} else if (isThinkingPart(part)) {
				const thinkingValue = getValueFromThinkingPart(part);
				if (thinkingValue) {
					totalChars += thinkingValue.length;
				}
			}
		}
		return Promise.resolve(Math.ceil(totalChars / 4));
	}

	private convertMessages(
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		thinkingEnabled: boolean,
	): KimiMessage[] {
		const result: KimiMessage[] = [];

		for (const msg of messages) {
			const role = this.convertRole(msg.role);
			const textParts: string[] = [];
			const imageParts: Array<{ type: "image_url"; image_url: { url: string } }> = [];
			let toolCalls: KimiMessage["tool_calls"] | undefined;
			const toolResults: Array<{ callId: string; content: string }> = [];
			let reasoningFromThinkingPart: string | undefined;

			for (const part of msg.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					textParts.push(part.value);
				} else if (part instanceof vscode.LanguageModelDataPart) {
					const mime = part.mimeType.toLowerCase();
					if (mime.startsWith("image/")) {
						const b64 = Buffer.from(part.data).toString("base64");
						imageParts.push({
							type: "image_url",
							image_url: { url: `data:${part.mimeType};base64,${b64}` },
						});
					} else if (
						mime === "text/plain" ||
						mime === "application/json" ||
						mime.endsWith("+json")
					) {
						textParts.push(new TextDecoder("utf-8", { fatal: false }).decode(part.data));
					} else {
						textParts.push(
							`\n[Attachment omitted (not an image): ${part.mimeType}, ${part.data.length} bytes]\n`,
						);
					}
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					if (!toolCalls) toolCalls = [];
					toolCalls.push({
						id: part.callId,
						type: "function",
						function: {
							name: part.name,
							arguments: JSON.stringify(part.input),
						},
					});
				} else if (part instanceof vscode.LanguageModelToolResultPart) {
					toolResults.push({
						callId: part.callId,
						content:
							typeof part.content === "string"
								? part.content
								: JSON.stringify(part.content),
					});
				} else if (isThinkingPart(part)) {
					const thinkingValue = getValueFromThinkingPart(part);
					if (thinkingValue) {
						reasoningFromThinkingPart = reasoningFromThinkingPart
							? reasoningFromThinkingPart + thinkingValue
							: thinkingValue;
					}
				}
			}

			for (const toolResult of toolResults) {
				result.push({ role: "tool", content: toolResult.content, tool_call_id: toolResult.callId });
			}

			if (toolCalls && toolCalls.length > 0) {
				const mergedText = textParts.join("") || "";
				if (thinkingEnabled && reasoningFromThinkingPart) {
					result.push({
						role: "assistant",
						content: mergedText,
						tool_calls: toolCalls,
						reasoning_content: reasoningFromThinkingPart,
					});
				} else if (thinkingEnabled) {
					const { content, reasoning_content } =
						assistantToolCallThinkingPayload(mergedText);
					result.push({
						role: "assistant",
						content,
						tool_calls: toolCalls,
						reasoning_content,
					});
				} else {
					result.push({
						role: "assistant",
						content: mergedText,
						tool_calls: toolCalls,
					});
				}
			} else if (toolResults.length === 0) {
				const content: KimiMessage["content"] =
					imageParts.length > 0
						? [
							...(textParts.length > 0
								? textParts.map((t) => ({ type: "text" as const, text: t }))
								: []),
							...imageParts,
						]
						: textParts.join("");
				result.push({ role, content, name: msg.name });
			}
		}

		return result;
	}

	private convertRole(
		role: vscode.LanguageModelChatMessageRole,
	): "system" | "user" | "assistant" {
		switch (role) {
			case vscode.LanguageModelChatMessageRole.User:
				return "user";
			case vscode.LanguageModelChatMessageRole.Assistant:
				return "assistant";
			default:
				return "user";
		}
	}

	private convertTools(
		tools?: readonly vscode.LanguageModelChatTool[],
	): KimiTool[] | undefined {
		if (!tools || tools.length === 0) return undefined;

		return tools.map((tool) => ({
			type: "function" as const,
			function: {
				name: tool.name,
				description: tool.description,
				parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
			},
		}));
	}

	private resolveThinkingEnabled(
		modelDef: (typeof KIMI_MODELS)[number] | undefined,
		options: vscode.ProvideLanguageModelChatResponseOptions,
	): boolean {
		if (!modelDef?.thinking) {
			return false;
		}
		if (modelDef.thinkingType === "only") return true;

		const mode = readStringOption(options, "thinkingMode");
		if (mode === "disabled") {
			return false;
		}

		return true;
	}
}

function createThinkingPart(text: string): vscode.LanguageModelResponsePart | undefined {
	const vscodeWithThinking = vscode as typeof vscode & {
		LanguageModelThinkingPart?: new (value: string) => vscode.LanguageModelResponsePart;
	};

	if (typeof vscodeWithThinking.LanguageModelThinkingPart !== "function") {
		return undefined;
	}

	return new vscodeWithThinking.LanguageModelThinkingPart(text) as unknown as vscode.LanguageModelResponsePart;
}

function getValueFromThinkingPart(part: unknown): string | undefined {
	const candidate = part as { value?: unknown } | null;
	if (!candidate || !candidate.value) {
		return undefined;
	}

	if (typeof candidate.value === "string") {
		return candidate.value;
	}

	if (Array.isArray(candidate.value)) {
		return candidate.value.join("");
	}

	return undefined;
}

function isThinkingPart(part: unknown): part is vscode.LanguageModelResponsePart {
	const vscodeWithThinking = vscode as typeof vscode & {
		LanguageModelThinkingPart?: new (value: string) => vscode.LanguageModelResponsePart;
	};

	if (typeof vscodeWithThinking.LanguageModelThinkingPart !== "function") {
		return false;
	}

	return part instanceof (vscodeWithThinking.LanguageModelThinkingPart as any);
}

function readStringOption(
	options: vscode.ProvideLanguageModelChatResponseOptions,
	key: string,
): string | undefined {
	// VS Code 1.120+: model-level config may be passed via modelOptions
	if (options.modelOptions) {
		const value = options.modelOptions[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}

	// VS Code 1.120 runtime: provider config passed as modelConfiguration
	const opts = options as { modelConfiguration?: Record<string, unknown>; configuration?: Record<string, unknown> };
	const modelConfig = opts.modelConfiguration;
	if (modelConfig && typeof modelConfig === "object") {
		const value = modelConfig[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}

	// VS Code <=1.119: provider config passed as configuration
	const legacyConfig = opts.configuration;
	if (legacyConfig && typeof legacyConfig === "object") {
		const value = legacyConfig[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}

	return undefined;
}
