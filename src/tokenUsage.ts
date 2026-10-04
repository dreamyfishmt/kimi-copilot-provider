/** Actual per-request usage; separate from account subscription quota and token estimates. */
export interface TokenUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_tokens_details?: { cached_tokens: number };
	completion_tokens_details?: { reasoning_tokens: number };
}

function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function asObject(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown> : {};
}

export function parseTokenUsage(value: unknown): TokenUsage | undefined {
	const raw = asObject(value);
	if (!isCount(raw.prompt_tokens) || !isCount(raw.completion_tokens)) return undefined;
	const total = raw.total_tokens ?? raw.prompt_tokens + raw.completion_tokens;
	if (!isCount(total)) return undefined;
	const usage: TokenUsage = {
		prompt_tokens: raw.prompt_tokens,
		completion_tokens: raw.completion_tokens,
		total_tokens: total,
	};
	const cached = asObject(raw.prompt_tokens_details).cached_tokens;
	if (isCount(cached)) usage.prompt_tokens_details = { cached_tokens: cached };
	const reasoning = asObject(raw.completion_tokens_details).reasoning_tokens;
	if (isCount(reasoning)) usage.completion_tokens_details = { reasoning_tokens: reasoning };
	return usage;
}
