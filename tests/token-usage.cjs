const assert = require('node:assert/strict');
const { test, after, afterEach } = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
const originalFetch = global.fetch;
const vscode = {
    version: '1.120.0',
    workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    LanguageModelChatToolMode: { Auto: 1, Required: 2 },
    LanguageModelTextPart: class { constructor(value) { this.value = value; } },
    LanguageModelThinkingPart: class { constructor(value) { this.value = value; } },
    LanguageModelToolCallPart: class {
        constructor(callId, name, input) { Object.assign(this, { callId, name, input }); }
    },
    LanguageModelDataPart: class {
        constructor(data, mimeType) { Object.assign(this, { data, mimeType }); }
    },
};
Module._load = function(id, ...args) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
const { KimiChatProvider } = require('../out/provider.js');
const { KimiApiClient } = require('../out/api.js');
const { parseTokenUsage } = require('../out/tokenUsage.js');
after(() => { Module._load = originalLoad; });
afterEach(() => { global.fetch = originalFetch; });
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
const usage = {
    prompt_tokens: 120, completion_tokens: 30, total_tokens: 150,
    prompt_tokens_details: { cached_tokens: 80 },
    completion_tokens_details: { reasoning_tokens: 20 },
};
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const textChunk = { choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: 'stop' }] };
const decodeUsage = parts => parts.filter(p => p.mimeType === 'usage').map(p => JSON.parse(new TextDecoder().decode(p.data)));

async function prepare() {
    const bodies = [];
    const logs = [];
    let sse = '';
    global.fetch = async (url, init) => {
        if (url.endsWith('/models')) return new Response('{}', { status: 503 });
        bodies.push(JSON.parse(init.body));
        // Deliberately split SSE lines across transport chunks.
        const bytes = new TextEncoder().encode(sse);
        return new Response(new ReadableStream({ start(controller) {
            for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
            controller.close();
        } }));
    };
    const provider = new KimiChatProvider(undefined, message => logs.push(message));
    const models = await provider.provideLanguageModelChatInformation({ modelConfiguration: { apiKey: 'test-only' } }, token);
    return {
        bodies, logs, provider,
        async send(value, cancellation = token) {
            sse = value;
            const parts = [];
            await provider.provideLanguageModelChatResponse(models.find(m => m.id === 'k3-256k'), [], {}, { report: p => parts.push(p) }, cancellation);
            return parts;
        },
    };
}

test('requests streaming usage and forwards the final snapshot once, retaining text, thinking and tools', async () => {
    const run = await prepare();
    try {
        const parts = await run.send(
            event({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 0 } }) +
            event({ choices: [{ delta: { reasoning_content: 'Thinking' }, finish_reason: null }] }) +
            event(textChunk) +
            event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'read', arguments: '{"path":' } }] }, finish_reason: null }] }) +
            event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }, finish_reason: 'tool_calls' }] }) +
            event({ choices: [], usage }) + event({ choices: [], usage }) + 'data: [DONE]\n\n');
        assert.deepEqual(run.bodies[0].stream_options, { include_usage: true });
        assert.deepEqual(decodeUsage(parts), [usage]);
        assert.equal(parts.find(p => p instanceof vscode.LanguageModelTextPart).value, 'Hello');
        assert.equal(parts.find(p => p instanceof vscode.LanguageModelThinkingPart).value, 'Thinking');
        assert.deepEqual(parts.find(p => p instanceof vscode.LanguageModelToolCallPart).input, { path: 'a.txt' });
        assert.ok(run.logs.includes('Token usage: input=120, output=30, total=150'));
        const next = await run.send(event(textChunk) + 'data: [DONE]\n\n');
        assert.deepEqual(decodeUsage(next), []); // No usage leaking between requests.
        assert.match(run.logs.at(-1), /unavailable/);
    } finally { run.provider.dispose(); }
});

test('accepts usage-only EOF without newline on permissive Coding endpoints', async () => {
    const run = await prepare();
    try {
        const parts = await run.send(event(textChunk) + `data: ${JSON.stringify({ usage })}`);
        assert.deepEqual(decodeUsage(parts), [usage]);
    } finally { run.provider.dispose(); }
});

test('missing, invalid and cancelled usage never becomes fabricated counts', async () => {
    const run = await prepare();
    try {
        for (const value of [null, {}, { prompt_tokens: -1, completion_tokens: 2 }]) {
            const parts = await run.send(event({ ...textChunk, usage: value }) + 'data: [DONE]\n\n');
            assert.deepEqual(decodeUsage(parts), []);
        }
        const parts = await run.send(event({ ...textChunk, usage }) + 'data: [DONE]\n\n', { ...token, isCancellationRequested: true });
        assert.deepEqual(decodeUsage(parts), []);
    } finally { run.provider.dispose(); }
});

test('usage validation preserves zero and derives only a missing total', () => {
    assert.deepEqual(parseTokenUsage({ prompt_tokens: 0, completion_tokens: 0 }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    for (const bad of [null, [], 'usage', {}, { prompt_tokens: '1', completion_tokens: 2 },
        { prompt_tokens: 1, completion_tokens: NaN }, { prompt_tokens: 1.5, completion_tokens: 2 },
        { prompt_tokens: 1, completion_tokens: 2, total_tokens: -1 }]) {
        assert.equal(parseTokenUsage(bad), undefined);
    }
    assert.deepEqual(parseTokenUsage({ prompt_tokens: 1, completion_tokens: 2, prompt_tokens_details: { cached_tokens: -1 } }),
        { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
});

test('non-streaming requests omit stream_options and strict SSE still rejects a missing DONE', async () => {
    let body;
    global.fetch = async (_url, init) => {
        body = JSON.parse(init.body);
        return new Response(body.stream ? event({ choices: [], usage }) : '{}');
    };
    const client = new KimiApiClient('test-only');
    await client.chat('test', [], 'https://example.invalid', {}, token);
    assert.equal(Object.hasOwn(body, 'stream_options'), false);
    await assert.rejects(async () => {
        for await (const _chunk of client.streamChat('test', [], 'https://example.invalid', {}, token)) {}
    }, /without a data: \[DONE\]/);
});
