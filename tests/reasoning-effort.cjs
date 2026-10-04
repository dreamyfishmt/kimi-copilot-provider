const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');

test('model picker selection reaches the HTTP request body', async () => {
    const originalLoad = Module._load;
    const originalFetch = globalThis.fetch;
    let body;
    let requests = 0;
    const settings = { reasoningEffort: 'high' };
    const vscode = {
        version: '1.140.0',
        workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) },
        EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
        LanguageModelChatToolMode: { Auto: 1, Required: 2 },
    };
    Module._load = function (id, ...args) {
        return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args);
    };
    globalThis.fetch = async (_url, init) => {
        requests++;
        body = JSON.parse(init.body);
        return new Response('data: [DONE]\n\n', { status: 200 });
    };
    try {
        const { KIMI_MODELS, toLanguageModelChatInformation } = require('../out/models.js');
        const { KimiChatProvider } = require('../out/provider.js');
        const provider = new KimiChatProvider();
        const models = provider.provideLanguageModelChatInformation({ modelConfiguration: { apiKey: 'test-only' } });
        for (const model of KIMI_MODELS) {
            const info = toLanguageModelChatInformation(model);
            assert.equal(Boolean(info.configurationSchema), model.supportsReasoningEffort);
            if (info.configurationSchema) {
                assert.deepEqual(info.configurationSchema.properties.reasoningEffort.enum, ['default', 'low', 'high', 'max']);
                assert.equal(info.configurationSchema.properties.reasoningEffort.group, 'navigation');
            }
        }
        const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
        async function send(options, id = 'k3-256k') {
            await provider.provideLanguageModelChatResponse(models.find(m => m.id === id), [], options, { report() {} }, token);
            return body;
        }
        for (const effort of ['low', 'high', 'max']) {
            assert.equal((await send({ modelConfiguration: { reasoningEffort: effort } })).reasoning_effort, effort);
        }
        assert.equal(Object.hasOwn(await send({ modelConfiguration: { reasoningEffort: 'default' } }), 'reasoning_effort'), false);
        assert.equal((await send({})).reasoning_effort, 'high');
        assert.equal((await send({ configuration: { reasoningEffort: 'low' } })).reasoning_effort, 'low');
        assert.equal((await send({ modelConfiguration: { reasoningEffort: 'max' }, configuration: { reasoningEffort: 'low' } })).reasoning_effort, 'max');
        assert.equal((await send({ modelOptions: { reasoningEffort: 'low' }, modelConfiguration: { reasoningEffort: 'max' } })).reasoning_effort, 'low');
        assert.equal(Object.hasOwn(await send({ modelConfiguration: { reasoningEffort: 'max' } }, 'kimi-for-coding-highspeed'), 'reasoning_effort'), false);
        assert.equal(Object.hasOwn(await send({ modelOptions: { thinkingMode: 'disabled' }, modelConfiguration: { reasoningEffort: 'max' } }), 'reasoning_effort'), false);
        const beforeInvalid = requests;
        await assert.rejects(send({ modelConfiguration: { reasoningEffort: 'invalid' } }), /Invalid reasoning effort/);
        assert.equal(requests, beforeInvalid);
    } finally {
        Module._load = originalLoad;
        globalThis.fetch = originalFetch;
    }
});
