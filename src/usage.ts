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
        this.item.name = "Kimi Code 用量";
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
        const percent = (entry?: UsageEntry) => entry ? `${Math.round(entry.usedRatio * 100)}%` : "—";
        this.item.text = this.usage
            ? `Kimi · 5h ${percent(this.usage.fiveHour)} · 周 ${percent(this.usage.weekly)}${this.error ? " · 未更新" : ""}`
            : loading ? "$(sync~spin) Kimi · 查询用量" : "Kimi · 用量不可用";
        const lines = ["Kimi Code 账号订阅额度（已使用比例）"];
        for (const [label, entry] of [["5 小时", this.usage?.fiveHour], ["每周", this.usage?.weekly]] as const) {
            lines.push(`${label}：${entry ? `已用 ${percent(entry)}` : "不可用"}`);
            if (entry?.resetAt) lines.push(`重置时间：${new Date(entry.resetAt).toLocaleString()}`);
        }
        lines.push(`最后成功更新：${this.updatedAt?.toLocaleString() ?? "尚未成功"}`);
        if (this.error) lines.push(`查询失败：${this.error}。不影响聊天请求。`);
        if (loading) lines.push("正在刷新…");
        lines.push("每 60 秒刷新；点击手动刷新或打开控制台。");
        this.item.tooltip = lines.join("\n");
        this.item.accessibilityInformation = { label: lines.join("。") };
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
