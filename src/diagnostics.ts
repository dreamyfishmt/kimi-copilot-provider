import * as vscode from "vscode";
import { KimiApiClient, KimiApiError } from "./api";
import { getReasoningEffort } from "./config";
import { getModelTokenBudget, parseModels, type KimiModelInfo } from "./models";
import type { KimiChatProvider } from "./provider";
import type { Account } from "./usage";

export interface DiagnosticCheck {
	name: string;
	status: "PASS" | "WARN" | "FAIL" | "CANCELLED";
	detail: string;
}

export interface DiagnosticDiscovery {
	models: readonly KimiModelInfo[];
	check: DiagnosticCheck;
}

function errorDetail(error: unknown): string {
	// Never include arbitrary server bodies/errors: a proxy can echo credentials or prompts.
	if (error instanceof KimiApiError) {
		const hints: Record<number, string> = {
			401: "Check the API key and subscription access to this model/context.",
			402: "Check membership benefits in the Kimi console.",
			403: "Check account quota and concurrent request limits in the Kimi console.",
			404: "Check the endpoint URL and whether it supports this API.",
			429: "The server is rate limited or overloaded; wait before trying again.",
		};
		return `HTTP ${error.statusCode}. ${hints[error.statusCode] ?? "Check endpoint connectivity and the service status."}`;
	}
	if (error instanceof Error && error.name === "AbortError") return "Request timed out or was cancelled. Check the connection and retry.";
	return "Network error or invalid response. Check the endpoint, proxy and connection.";
}

export async function discoverDiagnosticModels(
	account: Account,
	fallback: readonly KimiModelInfo[],
	signal: AbortSignal,
): Promise<DiagnosticDiscovery> {
	try {
		const payload = await new KimiApiClient(account.apiKey).getMetadata(account.baseUrl, "/models", signal);
		const models = parseModels(payload, account.baseUrl);
		return { models, check: {
			name: "Model discovery", status: models.length ? "PASS" : "FAIL",
			detail: models.length ? `${models.length} compatible models returned by the server.` : "The server returned no compatible chat models. Check account access and endpoint.",
		} };
	} catch (error) {
		return { models: signal.aborted ? [] : fallback, check: {
			name: "Model discovery", status: signal.aborted ? "CANCELLED" : "FAIL",
			detail: signal.aborted ? "Cancelled." : `${errorDetail(error)}${fallback.length ? " Cached/fallback models are available for response checks; discovery did not pass." : ""}`,
		} };
	}
}

export async function diagnoseResponses(
	account: Account,
	model: KimiModelInfo,
	signal: AbortSignal,
	onStep: (name: string) => void = () => {},
	timeoutMs = 60_000,
): Promise<DiagnosticCheck[]> {
	const checks: DiagnosticCheck[] = [];
	const thinking = model.thinking;
	let reasoningEffort;
	try {
		reasoningEffort = thinking && model.supportsReasoningEffort ? getReasoningEffort() : undefined;
		if (reasoningEffort && !model.reasoningEfforts?.includes(reasoningEffort)) {
			checks.push({ name: "Request settings", status: "FAIL", detail: "The global reasoning effort is unsupported by this model. Select a supported value or Default in Kimi settings." });
			return checks;
		}
	} catch {
		return [{ name: "Request settings", status: "FAIL", detail: "Invalid global reasoning effort. Check Kimi settings." }];
	}
	const options = {
		thinking, reasoningEffort,
		maxTokens: Math.min(1024, getModelTokenBudget(model).maxOutputTokens),
		requireSseDoneMarker: model.requireSseDoneMarker,
	};
	checks.push({ name: "Request settings", status: "PASS", detail: `Thinking ${thinking ? "enabled" : "disabled"}; effort ${reasoningEffort ?? "server default"}; diagnostic output limit ${options.maxTokens}.` });
	const client = new KimiApiClient(account.apiKey);
	const messages = [{ role: "user" as const, content: "Reply with OK only." }];
	for (const name of ["Non-streaming response", "Streaming response"]) {
		if (signal.aborted) {
			checks.push({ name, status: "CANCELLED", detail: "Cancelled; no further request sent." });
			break;
		}
		onStep(name);
		const controller = new AbortController();
		const requestSignal = AbortSignal.any([signal, controller.signal]);
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const started = Date.now();
		try {
			let receivedContent = false;
			let finishReason: string | undefined;
			if (name === "Non-streaming response") {
				const response = await client.chat(model.id, messages, account.baseUrl, options, undefined, requestSignal);
				const choice = response?.choices?.[0];
				const message = choice?.message as { content?: unknown; reasoning_content?: unknown } | undefined;
				receivedContent = [message?.content, message?.reasoning_content].some(value => typeof value === "string" && value.trim().length > 0);
				finishReason = choice?.finish_reason;
			} else {
				for await (const chunk of client.streamChat(model.id, messages, account.baseUrl, options, undefined, requestSignal)) {
					for (const choice of chunk.choices ?? []) {
						if (choice.index !== 0) continue;
						receivedContent ||= [choice.delta?.content, choice.delta?.reasoning_content].some(value => typeof value === "string" && value.trim().length > 0);
						if (choice.finish_reason) finishReason = choice.finish_reason;
					}
				}
			}
			if (requestSignal.aborted) throw new Error("Aborted");
			const elapsed = `${Date.now() - started} ms`;
			if (!receivedContent || !["stop", "length"].includes(finishReason ?? "")) {
				checks.push({ name, status: "FAIL", detail: `No valid completed text/thinking response (${elapsed}). Check endpoint response format; HTTP success alone does not pass.` });
			} else {
				checks.push({ name, status: finishReason === "length" ? "WARN" : "PASS", detail: finishReason === "length"
					? `Response received (${elapsed}), but reached the diagnostic output limit; the answer may be incomplete.`
					: `Completed text/thinking response received (${elapsed}).` });
			}
		} catch (error) {
			checks.push({ name, status: signal.aborted ? "CANCELLED" : "FAIL", detail: signal.aborted ? "Cancelled." : controller.signal.aborted ? "Timed out. Check connection or retry with a faster model/lower supported reasoning effort." : errorDetail(error) });
		} finally {
			clearTimeout(timer);
		}
	}
	return checks;
}

export function formatDiagnosticReport(account: Account, model: KimiModelInfo | undefined, checks: readonly DiagnosticCheck[]): string {
	const redact = (value: string) => value.split(account.apiKey).join("[REDACTED]").split(encodeURIComponent(account.apiKey)).join("[REDACTED]");
	let endpoint = "Invalid endpoint URL";
	try {
		const url = new URL(account.baseUrl);
		endpoint = url.origin + url.pathname; // Exclude URL credentials, query and fragment.
	} catch { /* Do not print unvalidated input. */ }
	return redact([
		"Kimi configuration diagnostics", `Time: ${new Date().toISOString()}`,
		`Extension: ${require("../package.json").version}; VS Code: ${vscode.version}`,
		`Endpoint: ${endpoint}`, `Model: ${model?.id ?? "Not selected"}`,
		"Scope: loaded provider account and global Kimi settings; current chat overrides are not inspected.",
		...checks.map(check => `[${check.status}] ${check.name}: ${check.detail}`),
		"This check does not verify images, tools, multi-turn history or maximum context entitlement.",
		"API keys, URL credentials/query/fragment, response bodies, prompts and model output are omitted.",
	].join("\n"));
}

export async function runConfigurationDiagnostics(provider: KimiChatProvider, output: vscode.OutputChannel): Promise<void> {
	try {
		// Ask VS Code to enumerate configured Kimi accounts after a fresh window reload.
		if (!provider.diagnosticConfiguration) await vscode.lm.selectChatModels({ vendor: "kimi" });
		const configuration = provider.diagnosticConfiguration;
		if (!configuration) {
			await vscode.window.showInformationMessage("Kimi: No provider key is loaded. Open Chat → Manage Language Models, add/configure Kimi, then run diagnostics again. No API key is requested or saved by this command.");
			return;
		}
		const report = await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification, title: "Kimi: Diagnose Current Configuration", cancellable: true,
		}, async (progress, token) => {
			const controller = new AbortController();
			const listener = token.onCancellationRequested(() => controller.abort());
			if (token.isCancellationRequested) controller.abort();
			try {
				progress.report({ message: "Checking model discovery…" });
				const discovery = await discoverDiagnosticModels(configuration.account, configuration.models, controller.signal);
				const checks = [discovery.check];
				let model: KimiModelInfo | undefined;
				if (discovery.models.length && !token.isCancellationRequested) {
					const selection = await vscode.window.showQuickPick(discovery.models.map(model => ({
						label: model.name, description: model.id, model,
					})), { title: "Kimi: Select a model to diagnose", placeHolder: "Sends two small test requests using the loaded key and global settings; uses account quota." }, token);
					if (!selection) return undefined;
					model = selection.model;
					checks.push(...await diagnoseResponses(configuration.account, model, controller.signal, name => progress.report({ message: `${name}…` })));
				}
				return { text: formatDiagnosticReport(configuration.account, model, checks), checks };
			} finally { listener.dispose(); }
		});
		if (!report) return;
		output.appendLine(report.text);
		output.show(true);
		const message = report.checks.some(check => check.status === "CANCELLED") ? "Kimi diagnostics cancelled."
			: report.checks.some(check => check.status === "FAIL") ? "Kimi diagnostics found a problem. See the Kimi output channel."
			: report.checks.some(check => check.status === "WARN") ? "Kimi diagnostics completed with a warning. See the Kimi output channel."
			: "Kimi diagnostics passed.";
		const action = await vscode.window.showInformationMessage(message, "Copy Sanitized Report");
		if (action === "Copy Sanitized Report") await vscode.env.clipboard.writeText(report.text);
	} catch {
		await vscode.window.showErrorMessage("Kimi diagnostics could not start. Check the endpoint settings and reopen Chat → Manage Language Models.");
	}
}
