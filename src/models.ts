import type * as vscode from "vscode";
import { getTokenBudgetSettings, type ReasoningEffort } from "./config";
export interface KimiModelInfo {
	id: string;
	name: string;
	family: string;
	version: string;
	contextWindow: number;
	tooltip: string;
	thinking: boolean;
    supportsReasoningEffort: boolean;
    reasoningEfforts?: ReasoningEffort[];
    defaultEffort?: ReasoningEffort;
    thinkingType?: "only" | "no" | "both";
	/**
	 * When true, streaming must include a terminal `data: [DONE]` SSE event (strict Moonshot behavior).
	 * Kimi Coding API may omit it; set false for those models.
	 */
	requireSseDoneMarker: boolean;
	capabilities: {
		imageInput: boolean;
		toolCalling: boolean;
	};
}
const COMMON_MODEL = {
    family: "kimi",
    thinking: true,
    supportsReasoningEffort: true,
    reasoningEfforts: ["low", "high", "max"] as ReasoningEffort[],
    defaultEffort: "high" as ReasoningEffort,
    requireSseDoneMarker: false,
    capabilities: {
        imageInput: true,
        toolCalling: true,
    },
};

export const KIMI_MODELS: KimiModelInfo[] = [
	 {
        ...COMMON_MODEL,
        id: "kimi-for-coding",
        name: "Kimi K2.8 Preview",
        version: "for-coding",
        tooltip: "Kimi Code",
        contextWindow: 1048576,
    },
    {
        ...COMMON_MODEL,
        id: "kimi-for-coding-highspeed",
        name: "Kimi K2.7 Code HighSpeed",
        version: "for-coding-highspeed",
        tooltip: "Kimi Code — requires HighSpeed access",
        contextWindow: 262144,
        supportsReasoningEffort: false,
    },
    {
        ...COMMON_MODEL,
        id: "k3",
        name: "Kimi K3",
        version: "k3",
        tooltip: "Kimi Code — context depends on your subscription",
        contextWindow: 1048576,
    },
    {
        ...COMMON_MODEL,
        id: "k3-256k",
        name: "Kimi K3 256K",
        version: "k3-256k",
        tooltip: "Kimi Code — requires K3 access",
        contextWindow: 262144,
    },
];
export function getModelTokenBudget(model: KimiModelInfo) {
    const settings = getTokenBudgetSettings();

    const contextWindow = model.contextWindow;
    const maxOutputTokens = Math.min(settings.maxOutputTokens, Math.max(1, contextWindow - 1));
    const maxInputTokens = contextWindow - maxOutputTokens;

    return {
        contextWindow,
        maxInputTokens,
        maxOutputTokens,
    };
}
function createReasoningEffortSchema(model: KimiModelInfo) {
    return {
        properties: {
            reasoningEffort: {
                type: "string",
                title: "Thinking Effort",
                // Agent Host filters out custom values such as "default".
                enum: model.reasoningEfforts ?? [],
                enumItemLabels: (model.reasoningEfforts ?? []).map(value => value[0].toUpperCase() + value.slice(1)),
                ...(model.defaultEffort ? { default: model.defaultEffort } : {}),
                description: "Reasoning effort used for model requests.",
                group: "navigation",
            },
        },
    };
}

// Supported by the current VS Code runtime, but not yet a stable public API.
type KimiChatInformation = vscode.LanguageModelChatInformation & {
    configurationSchema?: ReturnType<typeof createReasoningEffortSchema>;
};

export function toLanguageModelChatInformation(
	model: KimiModelInfo,
): KimiChatInformation {
	const budget = getModelTokenBudget(model);

	return {
		id: model.id,
		name: model.name,
		family: model.family,
		version: model.version,
		tooltip: model.tooltip,
		detail: `${model.tooltip} · ${
            budget.contextWindow / 1024
        }K context`,
        maxInputTokens: budget.maxInputTokens,
        maxOutputTokens: budget.maxOutputTokens,
        capabilities: model.capabilities,
        ...(model.supportsReasoningEffort
            ? { configurationSchema: createReasoningEffortSchema(model) }
            : {}),
    };
}

export function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
}

const EFFORTS: readonly string[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Only advertise protocols supported by this extension's chat/completions transport. */
export function parseModels(payload: unknown, baseUrl: string): KimiModelInfo[] {
    const data = record(payload)?.data;
    if (!Array.isArray(data)) throw new Error("Invalid model list response.");
    const models = new Map<string, KimiModelInfo>();
    for (const item of data) {
        const raw = record(item);
        if (!raw || typeof raw.id !== "string" || !raw.id.trim()) throw new Error("Invalid model ID.");
        if (raw.protocol !== undefined && !["kimi", "openai", "chat_completions"].includes(String(raw.protocol))) continue;
        const id = raw.id.trim();
        const known = KIMI_MODELS.find(model => model.id === id);
        const context = raw.context_length === undefined ? known?.contextWindow ?? 32768 : Number(raw.context_length);
        if (!Number.isSafeInteger(context) || context! < 2) throw new Error("Invalid model context length.");
        const thinkingType = ["only", "no", "both"].includes(String(raw.supports_thinking_type))
            ? raw.supports_thinking_type as KimiModelInfo["thinkingType"] : undefined;
        const thinking = thinkingType ? thinkingType !== "no"
            : typeof raw.supports_reasoning === "boolean" ? raw.supports_reasoning : known?.thinking ?? false;
        const effortInfo = record(raw.think_efforts);
        const rawEfforts = effortInfo ? (effortInfo.support === true ? effortInfo.valid_efforts : [])
            : raw.support_efforts ?? (known?.supportsReasoningEffort ? known.reasoningEfforts : []);
        const efforts = thinking && Array.isArray(rawEfforts)
            ? [...new Set(rawEfforts.filter((value): value is ReasoningEffort => typeof value === "string" && EFFORTS.includes(value)))] : [];
        const rawDefault = effortInfo ? effortInfo.default_effort : raw.default_effort ?? known?.defaultEffort;
        const defaultEffort = efforts.includes(rawDefault as ReasoningEffort) ? rawDefault as ReasoningEffort : undefined;
        models.set(id, {
            id, name: typeof raw.display_name === "string" && raw.display_name.trim() ? raw.display_name.trim() : known?.name ?? id,
            family: "kimi", version: id, contextWindow: context!, tooltip: "Kimi · discovered from API",
            thinking, thinkingType, supportsReasoningEffort: efforts.length > 0, reasoningEfforts: efforts, defaultEffort,
            requireSseDoneMarker: !new URL(baseUrl).pathname.includes("/coding/"),
            capabilities: {
                imageInput: typeof raw.supports_image_in === "boolean" ? raw.supports_image_in : known?.capabilities.imageInput ?? false,
                toolCalling: typeof raw.supports_tool_use === "boolean" ? raw.supports_tool_use : known?.capabilities.toolCalling ?? false,
            },
        });
    }
    return [...models.values()];
}

/** Persist only public model metadata, never response envelopes or credentials. */
export function serializeModels(models: KimiModelInfo[]): unknown {
    return { data: models.map(model => ({
        id: model.id, display_name: model.name, context_length: model.contextWindow,
        supports_reasoning: model.thinking, supports_thinking_type: model.thinkingType,
        supports_image_in: model.capabilities.imageInput, supports_tool_use: model.capabilities.toolCalling,
        think_efforts: { support: model.supportsReasoningEffort, valid_efforts: model.reasoningEfforts, default_effort: model.defaultEffort },
    })) };
}
