import * as vscode from "vscode";

export const CONFIG_SECTION = "kimi";
export const ENDPOINT_KEY = "endpoint";
export const API_BASE_URL_KEY = "apiBaseUrl";
export type ReasoningEffort = "low" | "high" | "max";
export const PRESET_URLS = {
    kimiCode: "https://api.kimi.ai/coding/v1",
    kimiCodeCN: "https://api.kimi.com/coding/v1",
    moonshot: "https://api.moonshot.ai/v1",
    moonshotCN: "https://api.moonshot.cn/v1"
} as const;

export function getApiBaseUrl(): string {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const endpoint = config.get<string>(ENDPOINT_KEY, "kimiCode");
    if ( endpoint !== "custom") {
        if (Object.prototype.hasOwnProperty.call(PRESET_URLS, endpoint)) {
            return PRESET_URLS[endpoint as keyof typeof PRESET_URLS];
        }

        throw new Error(`Unknown Kimi endpoint: ${endpoint}`);
    }
    const url = config.get<string>(API_BASE_URL_KEY);
    if (typeof url !== "string" || !url.trim()) {
        throw new Error("Please configure a custom API base URL.");
    }

    return url.trim().replace(/\/+$/, "");
}
export function getSendDeviceInfoEnabled(): boolean {
    return vscode.workspace.getConfiguration(CONFIG_SECTION)
        .get<unknown>("sendDeviceInfo", false) === true;
}

export function getReasoningEffort(selectedValue?: unknown): ReasoningEffort | undefined {
    const value = selectedValue === undefined
        ? vscode.workspace.getConfiguration(CONFIG_SECTION)
            .get<unknown>("reasoningEffort", "default")
        : selectedValue;

    switch (value) {
        case "default":
            return undefined;
        case "low":
        case "high":
        case "max":
            return value;
        default:
            throw new Error(
                "Invalid reasoning effort. Use default, low, high, or max.",
            );
    }
}
export async function setPresetEndpoint(
    endpoint: keyof typeof PRESET_URLS,
): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    await config.update(
        ENDPOINT_KEY,
        endpoint,
        vscode.ConfigurationTarget.Global,
    );
}
export async function setApiBaseUrl(
    url: string,
    global = true,
): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const target = global
        ? vscode.ConfigurationTarget.Global
        : vscode.ConfigurationTarget.Workspace;
    await config.update(API_BASE_URL_KEY, url, target);
    await config.update(ENDPOINT_KEY, "custom", target);
}

export function getTokenBudgetSettings(): {
    maxOutputTokens: number;
} {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    const rawOutput = config.get<unknown>("maxOutputTokens");

    return {
        maxOutputTokens:
            typeof rawOutput === "number" &&
            Number.isInteger(rawOutput) &&
            rawOutput >= 1 &&
            rawOutput <= 65536
                ? rawOutput
                : 32768,
    };
}
