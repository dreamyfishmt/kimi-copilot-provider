import * as vscode from "vscode";
import { KimiApiClient, KimiApiError, summarizeErrorResponse } from "./api";
import {
	API_BASE_URL_KEY,
	CONFIG_SECTION,
	getApiBaseUrl,
	PRESET_URLS,
	setApiBaseUrl,
	setPresetEndpoint,
} from "./config";
import { KimiChatProvider } from "./provider";
import { UsageStatusBar } from "./usage";

const DEFAULT_MODEL_ID = "kimi-for-coding";

function formatConnectionError(err: unknown): string {
	const detail = err instanceof KimiApiError && err.response
		? ` ${summarizeErrorResponse(err.response)}`
		: "";
	return `Kimi test failed: ${err instanceof Error ? err.message : String(err)}${detail}`;
}

async function runConnectionTest(): Promise<void> {
	const key = await vscode.window.showInputBox({
		prompt: "Enter your Kimi API key to test",
		password: true,
		placeHolder: "sk-...",
	});
	if (!key) return;

	const client = new KimiApiClient(key.trim());
	try {
		const baseUrl = getApiBaseUrl();
		await client.chat(
			DEFAULT_MODEL_ID,
			[{ role: "user", content: "Ping" }],
			baseUrl,
			{ maxTokens: 1 },
		);
		vscode.window.showInformationMessage(`Kimi connection test succeeded using ${baseUrl}.`);
	} catch (err) {
		vscode.window.showErrorMessage(formatConnectionError(err));
	}
}

async function setBaseUrlAndNotify(
	provider: KimiChatProvider,
	endpoint: keyof typeof PRESET_URLS,
	label: string,
): Promise<void> {
	await setPresetEndpoint(endpoint);
	provider.notifyModelsChanged();
	vscode.window.showInformationMessage(`Kimi: Switched to ${label} (${PRESET_URLS[endpoint]})`);
}

async function setCustomBaseUrl(provider: KimiChatProvider): Promise<void> {
	const input = await vscode.window.showInputBox({
		prompt: "Enter custom Kimi API base URL",
		placeHolder: "https://api.kimi.ai/coding/v1",
		value: vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.get<string>(API_BASE_URL_KEY, ""),
		validateInput: (value) => {
			if (!value || value.trim().length === 0) {
				return "URL cannot be empty";
			}
			try {
				new URL(value.trim());
				return undefined;
			} catch {
				return "Invalid URL";
			}
		},
	});
	if (!input) return;
	await setApiBaseUrl(input.trim());
	provider.notifyModelsChanged();

	vscode.window.showInformationMessage(
		`Kimi: Switched to custom endpoint (${input.trim()})`,
	);
}

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel("Kimi");
	const log = (message: string) => output.appendLine(`[${new Date().toISOString()}] ${message}`);
	const provider = new KimiChatProvider(context.globalState, log);
	const usage = new UsageStatusBar(log);
	const updateUsage = () => usage.configure(provider.account,
		vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>("showUsageStatusBar", true));

	context.subscriptions.push(
		output, provider, usage,
		provider.onDidChangeAccount(updateUsage),
		vscode.lm.registerLanguageModelChatProvider("kimi", provider),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("kimi.endpoint") || event.affectsConfiguration("kimi.apiBaseUrl")) {
				provider.configurationChanged();
			} else if (event.affectsConfiguration("kimi")) {
				provider.notifyModelsChanged();
			}
			if (event.affectsConfiguration("kimi")) updateUsage();
		}),
		vscode.commands.registerCommand("kimi.refreshModels", () => provider.refreshModels()),
		vscode.commands.registerCommand("kimi.refreshUsage", () => usage.refresh()),
		vscode.commands.registerCommand("kimi.usageActions", async () => {
			const action = await vscode.window.showQuickPick([
				{ label: "$(refresh) Refresh Usage", action: "refresh" },
				{ label: "$(link-external) Open Kimi Console", action: "console" },
			], { title: "Kimi Code Usage" });
			if (action?.action === "refresh") await usage.refresh();
			if (action?.action === "console") {
				await vscode.env.openExternal(vscode.Uri.parse("https://www.kimi.com/code/console"));
			}
		}),
		vscode.commands.registerCommand("kimi.testConnection", runConnectionTest),
		vscode.commands.registerCommand("kimi.setBaseUrl.kimiCode", () =>
			setBaseUrlAndNotify(provider, "kimiCode", "Global API (kimi.ai)"),
		),
		vscode.commands.registerCommand("kimi.setBaseUrl.kimiCodeCN", () =>
			setBaseUrlAndNotify(provider, "kimiCodeCN", "China API (kimi.com)"),
		),
		vscode.commands.registerCommand("kimi.setBaseUrl.moonshot", () =>
			setBaseUrlAndNotify(provider, "moonshot", "Moonshot API (moonshot.ai)"),
		),
		vscode.commands.registerCommand("kimi.setBaseUrl.moonshotCN", () =>
			setBaseUrlAndNotify(provider, "moonshotCN", "Moonshot China API (moonshot.cn)"),
		),
		vscode.commands.registerCommand("kimi.setBaseUrl.custom", () =>
			setCustomBaseUrl(provider),
		),
	);
}

export function deactivate(): void { }
