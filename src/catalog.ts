import { createHash } from "node:crypto";
import type * as vscode from "vscode";
import { KimiApiClient, KimiApiError } from "./api";
import { KIMI_MODELS, parseModels, serializeModels, type KimiModelInfo } from "./models";

export function accountId(apiKey: string, baseUrl: string): string {
    return createHash("sha256").update(JSON.stringify([baseUrl, apiKey])).digest("hex");
}

export function metadataError(error: unknown): string {
    if (error instanceof KimiApiError) {
        if ([401, 402, 403].includes(error.statusCode)) return `认证或访问权限失败 (HTTP ${error.statusCode})`;
        if (error.statusCode === 404) return "当前接口不支持此查询 (HTTP 404)";
        return `查询失败 (HTTP ${error.statusCode})`;
    }
    if (error instanceof Error && error.name === "AbortError") return "查询超时或已取消";
    return "网络错误或接口数据格式无效";
}

export class ModelCatalog implements vscode.Disposable {
    models: KimiModelInfo[] = [];
    source: "remote" | "cache" | "fallback" = "fallback";
    error: string | undefined;
    private hasSnapshot = false;
    private attempted = false;
    private lastAttempt = 0;
    private flight: Promise<void> | undefined;
    private controller: AbortController | undefined;
    private disposed = false;
    private readonly cacheKey: string;

    constructor(
        readonly apiKey: string,
        readonly baseUrl: string,
        private readonly storage: vscode.Memento | undefined,
        private readonly changed: () => void,
        private readonly log: (message: string) => void,
    ) {
        this.cacheKey = `kimi.models.v1.${accountId(apiKey, baseUrl)}`;
        try {
            const cached = storage?.get<unknown>(this.cacheKey);
            if (cached !== undefined) {
                this.models = parseModels(cached, baseUrl);
                this.hasSnapshot = true;
                this.source = "cache";
            }
        } catch { /* Discard invalid caches and discover again. */ }
    }

    async prepare(): Promise<KimiModelInfo[]> {
        // VS Code can enumerate every configured account after our change event.
        // Throttle rediscovery so switching between those callbacks cannot loop.
        if (!this.attempted || Date.now() - this.lastAttempt >= 300_000) {
            const refresh = this.refresh();
            if (!this.hasSnapshot) await refresh;
        } else if (!this.hasSnapshot && this.flight) {
            await this.flight;
        }
        return this.models;
    }

    refresh(): Promise<void> {
        if (this.disposed) return Promise.resolve();
        if (this.flight) return this.flight;
        this.attempted = true;
        this.lastAttempt = Date.now();
        const controller = this.controller = new AbortController();
        this.flight = this.fetch(controller).finally(() => { this.flight = undefined; });
        return this.flight;
    }

    private async fetch(controller: AbortController): Promise<void> {
        try {
            const payload = await new KimiApiClient(this.apiKey).getMetadata(this.baseUrl, "/models", controller.signal);
            const models = parseModels(payload, this.baseUrl);
            if (this.disposed) return;
            this.models = models;
            this.hasSnapshot = true;
            this.source = "remote";
            this.error = undefined;
            try { await this.storage?.update(this.cacheKey, serializeModels(models)); }
            catch { this.log("Model cache could not be saved."); }
        } catch (error) {
            if (this.disposed) return;
            this.error = metadataError(error);
            this.log(`Models: ${this.error}`);
            if (error instanceof KimiApiError && [401, 402, 403].includes(error.statusCode)) {
                this.models = [];
                this.hasSnapshot = false;
            } else if (this.hasSnapshot) {
                this.source = "cache";
            } else {
                this.models = new URL(this.baseUrl).pathname.includes("/coding/") ? KIMI_MODELS : [];
                this.source = "fallback";
            }
        }
        if (!this.disposed) this.changed();
    }

    dispose(): void {
        this.disposed = true;
        this.controller?.abort();
    }
}
