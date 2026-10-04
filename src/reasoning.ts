export function assistantToolCallThinkingPayload(mergedText: string): {
	content: string;
	reasoning_content: string;
} {
	const trimmed = mergedText.trim();
	if (trimmed.length === 0) {
		return { content: "", reasoning_content: "" };
	}

	return { content: mergedText, reasoning_content: "" };
}
