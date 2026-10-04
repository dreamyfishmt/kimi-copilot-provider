import * as vscode from "vscode";
import { KimiApiClient } from "./api";
import { metadataError } from "./catalog";
import { record } from "./models";

export interface UsageEntry { usedRatio: number; resetAt?: string }
export interface Usage { fiveHour?: UsageEntry; weekly?: UsageEntry }
export interface Account { apiKey: string; baseUrl: string }

export function parseUsage(payload: unknown): Usage {
    const usages = record(record(payload)?.usages);
    if (!usages) throw new Error("Invalid usage response.");
    const entry = (value: unknown): UsageEntry | undefined => {
        const raw = record(value);
        const ratio = raw?.used_ratio;
        if (typeof ratio !== "number" && (typeof ratio !== "string" || !ratio.trim())) return undefined;
        const number = Number(ratio);
        if (!Number.isFinite(number) || number < 0) return undefined;
        const reset = raw?.reset_time;
        return { usedRatio: number, resetAt: typeof reset === "string" && Number.isFinite(Date.parse(reset)) ? reset : undefined };
    };
    const result = { fiveHour: entry(usages.limit_5h), weekly: entry(usages.limit_7d) };
    if (!result.fiveHour && !result.weekly) throw new Error("No supported usage windows.");
    return result;
}

function formatElapsed(milliseconds: number): string {
    const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes % 1440 / 60);
    if (days) return `${days}d${hours ? ` ${hours}h` : ""}`;
    if (hours) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
    return `${minutes}m`;
}

function formatReset(resetAt: string, now: number): string {
    const remaining = Date.parse(resetAt) - now;
    if (remaining <= 0) return "Reset time reached · awaiting update";
    return remaining < 60_000 ? "Resets in <1m" : `Resets in ${formatElapsed(remaining)}`;
}

function formatLocalTime(date: Date): string {
    return date.toLocaleString("en-US", { timeZoneName: "short" });
}

function usageBar(ratio: number): string {
    const filled = Math.min(ratio < 1 ? 9 : 10, Math.round(Math.max(0, ratio) * 10));
    return "■".repeat(filled) + "□".repeat(10 - filled);
}

export class UsageStatusBar implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    private account: Account | undefined;
    private enabled = false;
    private timer: ReturnType<typeof setInterval> | undefined;
    private controller: AbortController | undefined;
    private flight: Promise<void> | undefined;
    private generation = 0;
    private usage: Usage | undefined;
    private updatedAt: Date | undefined;
    private error: string | undefined;
    private disposed = false;

    constructor(private readonly log: (message: string) => void) {
        this.item.name = "Kimi Code Usage";
        this.item.command = "kimi.usageActions";
    }

    configure(account: Account | undefined, enabled: boolean): void {
        if (this.disposed) return;
        if (this.account?.apiKey === account?.apiKey && this.account?.baseUrl === account?.baseUrl && this.enabled === enabled) return;
        this.stop();
        this.account = account;
        this.enabled = enabled;
        this.usage = undefined;
        this.updatedAt = undefined;
        this.error = undefined;
        if (!account || !enabled) { this.item.hide(); return; }
        this.item.show();
        void this.refresh();
        this.timer = setInterval(() => { void this.refresh(); }, 60_000);
    }

    refresh(): Promise<void> {
        if (!this.account || !this.enabled || this.disposed) return Promise.resolve();
        if (this.flight) return this.flight;
        const generation = this.generation;
        const account = this.account;
        const controller = this.controller = new AbortController();
        this.render(true);
        this.flight = (async () => {
            try {
                const payload = await new KimiApiClient(account.apiKey).getMetadata(account.baseUrl, "/usages", controller.signal);
                const usage = parseUsage(payload);
                if (generation !== this.generation) return;
                this.usage = usage;
                this.updatedAt = new Date();
                this.error = undefined;
            } catch (error) {
                if (generation !== this.generation) return;
                this.error = metadataError(error);
                this.log(`Usage: ${this.error}`);
            } finally {
                if (generation === this.generation) {
                    this.flight = undefined;
                    this.render(false);
                }
            }
        })();
        return this.flight;
    }

    private render(loading: boolean): void {
        const now = Date.now();
        const percent = (entry?: UsageEntry) => entry ? `${Math.round(entry.usedRatio * 100)}%` : "—";
        const icon = loading ? "$(sync~spin)" : "$(dashboard)";
        this.item.text = this.usage
            ? `${icon} Kimi · 5h ${percent(this.usage.fiveHour)} · 7d ${percent(this.usage.weekly)}${this.error ? " $(warning)" : ""}`
            : loading ? `${icon} Kimi · Loading usage` : "$(warning) Kimi · Usage unavailable";

        const tooltip = new vscode.MarkdownString("", true);
        tooltip.isTrusted = { enabledCommands: ["kimi.refreshUsage"] };
        tooltip.appendMarkdown("$(dashboard) **Kimi Code Usage**\n\nAccount quota · percentage used\n\n");
        const accessible = ["Kimi Code Usage. Account quota, percentage used."];
        for (const [label, entry] of [["5-hour limit", this.usage?.fiveHour], ["Weekly limit", this.usage?.weekly]] as const) {
            const value = entry ? `${percent(entry)} used` : "— · Unavailable";
            tooltip.appendMarkdown(`**${label} · ${value}**\n\n`);
            accessible.push(`${label}: ${entry ? value : "unavailable"}.`);
            if (entry) tooltip.appendMarkdown(`\`${usageBar(entry.usedRatio)}\`\n\n`);
            if (entry?.resetAt) {
                const reset = formatReset(entry.resetAt, now);
                const localTime = formatLocalTime(new Date(entry.resetAt));
                tooltip.appendText(reset);
                tooltip.appendMarkdown("  \n");
                tooltip.appendText(`Reset: ${localTime}`);
                tooltip.appendMarkdown("\n\n");
                accessible.push(`${reset}. Reset: ${localTime}.`);
            }
        }
        tooltip.appendMarkdown("---\n\n");
        const elapsed = this.updatedAt ? now - this.updatedAt.getTime() : undefined;
        const updated = elapsed === undefined ? "No successful update yet"
            : elapsed < 60_000 ? "Updated just now" : `Updated ${formatElapsed(elapsed)} ago`;
        tooltip.appendText(`${updated} · Every 60s`);
        tooltip.appendMarkdown("\n\n");
        accessible.push(`${updated}. Refreshes every 60 seconds.`);
        if (this.updatedAt) {
            const lastSuccess = `Last success: ${formatLocalTime(this.updatedAt)}`;
            tooltip.appendText(lastSuccess);
            tooltip.appendMarkdown("\n\n");
            accessible.push(`${lastSuccess}.`);
        }
        if (this.error) {
            const state = this.usage ? "Stale · Refresh failed" : "Usage unavailable · Refresh failed";
            tooltip.appendMarkdown(`$(warning) **${state}**  \n`);
            tooltip.appendText(`${this.error}. Chat requests are unaffected.`);
            tooltip.appendMarkdown("\n\n");
            accessible.push(`${state}. ${this.error}. Chat requests are unaffected.`);
        }
        if (loading) {
            tooltip.appendMarkdown("$(sync~spin) Refreshing…\n\n");
            accessible.push("Refreshing.");
        }
        tooltip.appendMarkdown("[$(refresh) Refresh](command:kimi.refreshUsage) · [$(link-external) Open Console](https://www.kimi.com/code/console)");
        accessible.push("Click for Refresh Usage or Open Kimi Console.");
        this.item.tooltip = tooltip;
        this.item.accessibilityInformation = { label: accessible.join(" ") };
    }

    private stop(): void {
        this.generation++;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.controller?.abort();
        this.controller = undefined;
        this.flight = undefined;
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
        this.item.dispose();
    }
}
