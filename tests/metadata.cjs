const assert = require('node:assert/strict');
const { test, after, beforeEach, afterEach } = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
const originalFetch = global.fetch;
const settings = {};
let item;
const vscode = {
    version: '1.120.0',
    workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) },
    EventEmitter: class {
        listeners = new Set();
        event = fn => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; };
        fire(value) { for (const fn of this.listeners) fn(value); }
        dispose() { this.listeners.clear(); }
    },
    StatusBarAlignment: { Right: 2 },
    window: { createStatusBarItem: () => item = {
        visible: false, show() { this.visible = true; }, hide() { this.visible = false; }, dispose() { this.visible = false; },
    } },
    LanguageModelChatToolMode: { Auto: 1, Required: 2 },
};
Module._load = function(id, ...args) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
const { ModelCatalog } = require('../out/catalog.js');
const { parseModels, serializeModels, getModelTokenBudget } = require('../out/models.js');
const { UsageStatusBar, parseUsage } = require('../out/usage.js');
const { KimiChatProvider } = require('../out/provider.js');
const { KimiApiClient } = require('../out/api.js');
after(() => { Module._load = originalLoad; global.fetch = originalFetch; });
beforeEach(() => { for (const key of Object.keys(settings)) delete settings[key]; });
afterEach(() => { global.fetch = originalFetch; });
const base = 'https://api.kimi.ai/coding/v1';
const account = { apiKey: 'test-key', baseUrl: base };
const payload = { data: [{ id: 'new-model', display_name: 'New model', context_length: 131072,
    supports_thinking_type: 'both', supports_image_in: false, supports_tool_use: true,
    think_efforts: { support: true, valid_efforts: ['low', 'medium', 'max'], default_effort: 'medium' },
}] };
const usagePayload = { usages: { limit_5h: { used_ratio: '0.32', reset_time: '2026-10-05T06:00:00Z' }, limit_7d: { used_ratio: 0.68 } } };
const json = value => new Response(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const memory = () => {
    const values = new Map();
    return { values, get: key => values.get(key), update: async (key, value) => { values.set(key, value); } };
};
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

test('server capabilities, protocol filtering, efforts and safe context budgets', () => {
    const models = parseModels(payload, base);
    assert.equal(models[0].defaultEffort, 'medium');
    assert.deepEqual(models[0].reasoningEfforts, ['low', 'medium', 'max']);
    assert.deepEqual(models[0].capabilities, { imageInput: false, toolCalling: true });
    assert.deepEqual(parseModels(serializeModels(models), base), models);
    assert.equal(parseModels({ data: [{ id: 'other-protocol', protocol: 'anthropic' }] }, base).length, 0);
    const small = parseModels({ data: [{ id: 'small', context_length: 8192 }] }, base)[0];
    assert.ok(getModelTokenBudget(small).maxInputTokens > 0);
    assert.equal(small.thinking, false);
    assert.equal(small.capabilities.toolCalling, false);
    assert.throws(() => parseModels({ data: [{ id: 'bad', context_length: -10 }] }, base));
    const noEffort = parseModels({ data: [{ id: 'k3', think_efforts: { support: false } }] }, base)[0];
    assert.equal(noEffort.supportsReasoningEffort, false);
    assert.equal(parseModels({data:[{id:'kimi-for-coding-highspeed'}]}, base)[0].supportsReasoningEffort, false);
});

test('catalog persists metadata, isolates accounts and endpoints, retains cache on failure and accepts empty lists', async () => {
    const storage = memory();
    let requests = 0;
    global.fetch = async () => { requests++; return json(payload); };
    const first = new ModelCatalog('key-a', base, storage, () => {}, () => {});
    await first.prepare();
    await first.prepare();
    assert.equal(requests, 1);
    assert.equal(first.models[0].id, 'new-model');
    assert.ok(!JSON.stringify([...storage.values]).includes('key-a'));
    global.fetch = async () => new Response('', { status: 503 });
    const cached = new ModelCatalog('key-a', base, storage, () => {}, () => {});
    await cached.prepare();
    await cached.refresh();
    assert.equal(cached.source, 'cache');
    assert.equal(cached.models[0].id, 'new-model');
    for (const [key, url] of [['key-b', base], ['key-a', 'https://api.kimi.com/coding/v1']]) {
        const other = new ModelCatalog(key, url, storage, () => {}, () => {});
        await other.prepare();
        assert.equal(other.source, 'fallback');
        assert.ok(other.models.every(m => m.id !== 'new-model'));
        other.dispose();
    }
    global.fetch = async () => json({data: []});
    await cached.refresh();
    assert.deepEqual(cached.models, []);
    assert.equal(cached.source, 'remote');
    global.fetch = async () => new Response('', {status: 401});
    await first.refresh();
    assert.deepEqual(first.models, []);
    assert.match(first.error, /401/);
    first.dispose(); cached.dispose();
});

test('catalog deduplicates requests and ignores results after disposal', async () => {
    let finish;
    let calls = 0;
    let changed = 0;
    global.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    const catalog = new ModelCatalog('key', base, memory(), () => changed++, () => {});
    const first = catalog.refresh();
    assert.equal(catalog.refresh(), first);
    assert.equal(calls, 1);
    catalog.dispose();
    finish(json(payload));
    await first;
    assert.equal(changed, 0);
    assert.deepEqual(catalog.models, []);
});

test('dynamic models send successfully and use their actual reasoning capabilities', async () => {
    const bodies = [];
    global.fetch = async (url, init) => {
        if (url.endsWith('/models')) return json(payload);
        bodies.push(JSON.parse(init.body));
        return new Response('data: [DONE]\n\n');
    };
    const provider = new KimiChatProvider(memory());
    const models = await provider.provideLanguageModelChatInformation({modelConfiguration:{apiKey:'key'}}, token);
    assert.deepEqual(models.map(m => m.id), ['new-model']);
    assert.equal(models[0].configurationSchema.properties.reasoningEffort.default, 'medium');
    const send = options => provider.provideLanguageModelChatResponse(models[0], [], options, {report(){}}, token);
    await send({modelOptions:{reasoningEffort:'medium'}});
    assert.equal(bodies[0].model, 'new-model');
    assert.equal(bodies[0].reasoning_effort, 'medium');
    await assert.rejects(send({modelOptions:{reasoningEffort:'high'}}), /not supported/);
    await provider.provideLanguageModelChatInformation({}, token); // vendor scan must not wipe credentials
    await send({});
    await provider.provideLanguageModelChatInformation({modelConfiguration:{apiKey:''}}, token);
    await assert.rejects(send({}), /API key not configured/);
    provider.dispose();
});

test('usage parsing distinguishes missing from zero and rejects malformed ratios', () => {
    assert.equal(parseUsage(usagePayload).fiveHour.usedRatio, 0.32);
    assert.deepEqual(parseUsage({usages:{limit_7d:{used_ratio:0}}}), {fiveHour:undefined,weekly:{usedRatio:0,resetAt:undefined}});
    for (const used_ratio of [null, '', ' ', false, -1, Infinity, 'bad']) {
        assert.throws(() => parseUsage({usages:{limit_5h:{used_ratio}}}));
    }
});

test('endpoint switches route existing models to the new endpoint and refresh catalog', async () => {
    const seen = [];
    global.fetch = async (url, init) => {
        seen.push({url, authorization:init.headers.Authorization});
        return url.endsWith('/models') ? json(payload) : new Response('data: [DONE]\n\n');
    };
    const provider = new KimiChatProvider(memory());
    try {
        const [model] = await provider.provideLanguageModelChatInformation({modelConfiguration:{apiKey:'key'}},token);
        settings.endpoint = 'kimiCodeCN';
        provider.configurationChanged();
        await provider.provideLanguageModelChatInformation({modelConfiguration:{apiKey:'key'}},token);
        await provider.provideLanguageModelChatResponse(model,[],{}, {report(){}},token);
        assert.equal(seen.at(-1).url,'https://api.kimi.com/coding/v1/chat/completions');
        assert.equal(seen.at(-1).authorization,'Bearer key');
        assert.ok(seen.some(r => r.url === 'https://api.kimi.com/coding/v1/models'));
    } finally { provider.dispose(); }
});

test('explicitly removed credentials cannot be reused by an old model object', async () => {
    let authorization;
    global.fetch = async (url, init) => {
        if (url.endsWith('/models')) return json(payload);
        authorization = init.headers.Authorization;
        return new Response('data: [DONE]\n\n');
    };
    const provider = new KimiChatProvider(memory());
    try {
        const [oldModel] = await provider.provideLanguageModelChatInformation({modelConfiguration:{apiKey:'old-key'}},token);
        await provider.provideLanguageModelChatInformation({modelConfiguration:{apiKey:''}},token);
        await provider.provideLanguageModelChatInformation({modelConfiguration:{apiKey:'new-key'}},token);
        await provider.provideLanguageModelChatResponse(oldModel,[],{}, {report(){}},token);
        assert.equal(authorization,'Bearer new-key');
    } finally { provider.dispose(); }
});

test('re-enumerating multiple provider configurations does not cause a discovery refresh loop', async () => {
    let discoveries = 0;
    global.fetch = async () => { discoveries++; return json(payload); };
    const provider = new KimiChatProvider(memory());
    try {
        for (let scan = 0; scan < 3; scan++) {
            for (const apiKey of ['key-a','key-b']) {
                await provider.provideLanguageModelChatInformation({modelConfiguration:{apiKey}},token);
            }
        }
        assert.equal(discoveries, 2);
    } finally { provider.dispose(); }
});

test('status bar polls every minute, retains stale data, stops when hidden and deduplicates manual refresh', async t => {
    t.mock.timers.enable({apis:['setInterval']});
    let requests = 0;
    global.fetch = async () => { requests++; return json(usagePayload); };
    const usage = new UsageStatusBar(() => {});
    try {
        usage.configure(account, true);
        await usage.refresh();
        assert.equal(item.visible, true);
        assert.match(item.text, /5h 32%.*周 68%/);
        assert.match(item.tooltip, /已使用比例/);
        t.mock.timers.tick(59_999); await tick();
        assert.equal(requests, 1);
        t.mock.timers.tick(1); await tick();
        assert.equal(requests, 2);
        global.fetch = async () => { throw new Error('sensitive response should not be printed'); };
        await usage.refresh();
        assert.match(item.text, /32%.*未更新/);
        assert.ok(!item.tooltip.includes('sensitive'));
        let finish;
        global.fetch = () => new Promise(resolve => { finish = resolve; });
        const flight = usage.refresh();
        assert.equal(usage.refresh(), flight);
        usage.configure(account, false);
        finish(json(usagePayload)); await flight;
        assert.equal(item.visible, false);
        const before = requests;
        t.mock.timers.tick(120_000); await tick();
        assert.equal(requests, before);
    } finally { usage.dispose(); }
});

test('changing accounts aborts old quota requests and prevents stale results', async () => {
    let finish;
    let signal;
    global.fetch = (_url, init) => { signal = init.signal; return new Promise(resolve => {finish = resolve;}); };
    const usage = new UsageStatusBar(() => {});
    try {
        usage.configure(account, true);
        const oldFlight = usage.refresh();
        global.fetch = async () => json({usages:{limit_5h:{used_ratio:0.05}}});
        usage.configure({...account,apiKey:'new-key'}, true);
        await usage.refresh();
        assert.equal(signal.aborted, true);
        finish(json(usagePayload)); await oldFlight;
        assert.match(item.text, /5h 5%.*周 —/);
        usage.configure(undefined, true);
        assert.equal(item.visible, false);
    } finally { usage.dispose(); }
});

test('quota failure and pending requests never block chat requests', async () => {
    let failUsage;
    let chatRequests = 0;
    global.fetch = async (url) => {
        if (url.endsWith('/models')) return json(payload);
        if (url.endsWith('/usages')) return new Promise((_, reject) => { failUsage = reject; });
        chatRequests++;
        return new Response('data: [DONE]\n\n');
    };
    const provider = new KimiChatProvider(memory());
    const usage = new UsageStatusBar(() => {});
    const listener = provider.onDidChangeAccount(value => usage.configure(value,true));
    try {
        const models = await provider.provideLanguageModelChatInformation({modelConfiguration:{apiKey:'key'}}, token);
        await provider.provideLanguageModelChatResponse(models[0], [], {}, {report(){}}, token);
        assert.equal(chatRequests, 1);
        failUsage(new Error('offline')); await usage.refresh();
        assert.match(item.text, /用量不可用/);
        await provider.provideLanguageModelChatResponse(models[0], [], {}, {report(){}}, token);
        assert.equal(chatRequests, 2);
    } finally { listener.dispose(); usage.dispose(); provider.dispose(); }
});

test('metadata timeout includes slow response bodies and only aborts its own request', async t => {
    t.mock.timers.enable({apis:['setTimeout']});
    let signal;
    global.fetch = async (_url, init) => {
        signal = init.signal;
        return {ok:true, json: () => new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })};
    };
    const external = new AbortController();
    const pending = new KimiApiClient('test-key').getMetadata(base, '/usages', external.signal);
    await Promise.resolve();
    t.mock.timers.tick(10_000);
    await assert.rejects(pending, {name:'AbortError'});
    assert.equal(signal.aborted, true);
    assert.equal(external.signal.aborted, false);
});
