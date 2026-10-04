import type * as vscode from "vscode";
import { getTokenBudgetSettings } from "./config";
interface KimiModelInfo {
	id: string;
	name: string;
	family: string;
	version: string;
	contextWindow: number;
	tooltip: string;
	thinking: boolean;
    supportsReasoningEffort: boolean;
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
    const maxOutputTokens = settings.maxOutputTokens;
    const maxInputTokens = contextWindow - maxOutputTokens;

    return {
        contextWindow,
        maxInputTokens,
        maxOutputTokens,
    };
}
function createReasoningEffortSchema() {
    return {
        properties: {
            reasoningEffort: {
                type: "string",
                title: "Thinking Effort",
                enum: ["default", "low", "high", "max"],
                enumItemLabels: ["Default", "Low", "High", "Max"],
                default: "default",
                description: "Reasoning effort. Default uses the server default.",
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
            ? { configurationSchema: createReasoningEffortSchema() }
            : {}),
    };
}
