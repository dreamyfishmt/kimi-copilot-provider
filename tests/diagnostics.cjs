const assert = require('node:assert/strict');
const { test, after, beforeEach, afterEach } = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
const originalFetch = global.fetch;
const settings = {};
let selection, copied, notifications, reports, token;
const vscode = {
    version: '1.120.0',
    workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) },
    EventEmitter: class {
        event = () => ({ dispose() {} }); fire() {} dispose() {}
    },
    ProgressLocation: { Notification: 15 },
	LanguageModelChatToolMode: { Auto: 1, Required: 2 },
    lm: { selectChatModels: async () => [] },
    window: {
        showInformationMessage: async message => { notifications.push(message); return 'Copy Sanitized Report'; },
        showErrorMessage: async message => { notifications.push(message); },
        showQuickPick: async items => selection === false ? undefined : items[selection ?? 0],
        withProgress: async (_, task) => task({ report() {} }, token),
        showInputBox: () => { throw new Error('Must never prompt for credentials'); },
    },
    env: { clipboard: { writeText: async text => { copied = text; } } },
};
Module._load = function(id, ...args) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
const { discoverDiagnosticModels, diagnoseResponses, formatDiagnosticReport, runConfigurationDiagnostics } = require('../out/diagnostics.js');
const { KimiChatProvider } = require('../out/provider.js');
const { KimiApiClient } = require('../out/api.js');
const { parseModels } = require('../out/models.js');
after(() => { Module._load = originalLoad; global.fetch = originalFetch; });
beforeEach(() => {
    for (const key of Object.keys(settings)) delete settings[key];
    selection = undefined; copied = undefined; notifications = []; reports = [];
    token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
});
afterEach(() => { global.fetch = originalFetch; });
const account = { apiKey: 'private test/key', baseUrl: 'https://api.kimi.ai/coding/v1' };
const payload = { data: [{ id: 'selected-model', display_name: 'Selected model', context_length: 262144,
    supports_thinking_type: 'both', think_efforts: { support: true, valid_efforts: ['low', 'high'], default_effort: 'high' } }] };
const model = parseModels(payload, account.baseUrl)[0];
const json = value => new Response(JSON.stringify(value));
const answer = reason => ({ choices: [{ index: 0, message: { content: 'OK' }, finish_reason: reason }] });
const sse = reason => new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`);
const output = { appendLine: text => reports.push(text), show() {} };

test('discovery distinguishes live success, empty catalog and fallback after failure', async () => {
    const signal = new AbortController().signal;
    global.fetch = async () => json(payload);
    const live = await discoverDiagnosticModels(account, [], signal);
    assert.equal(live.check.status, 'PASS');
    assert.equal(live.models[0].id, model.id);
    global.fetch = async () => json({ data: [] });
    const empty = await discoverDiagnosticModels(account, [model], signal);
    assert.equal(empty.check.status, 'FAIL');
    assert.deepEqual(empty.models, []);
    global.fetch = async () => new Response('echo private test/key', { status: 401 });
    const failed = await discoverDiagnosticModels(account, [model], signal);
    assert.equal(failed.check.status, 'FAIL');
    assert.equal(failed.models[0].id, model.id);
    assert.ok(!failed.check.detail.includes(account.apiKey));
});

test('both response checks use the loaded endpoint/key, selected model and global effort/output cap', async () => {
    settings.reasoningEffort = 'low'; settings.maxOutputTokens = 64;
    const requests = [];
    global.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        requests.push({ url, init, body });
        return body.stream ? sse('stop') : json(answer('stop'));
    };
    const checks = await diagnoseResponses(account, model, new AbortController().signal);
    assert.deepEqual(checks.map(check => check.status), ['PASS', 'PASS', 'PASS']);
    assert.equal(requests.length, 2);
    for (const { url, init, body } of requests) {
        assert.equal(url, account.baseUrl + '/chat/completions');
        assert.equal(init.headers.Authorization, 'Bearer ' + account.apiKey);
        assert.equal(body.model, model.id);
        assert.equal(body.reasoning_effort, 'low');
        assert.equal(body.max_completion_tokens, 64);
    }
    assert.equal(requests[0].body.stream, false);
    assert.equal(requests[1].body.stream, true);
});

test('unsupported global effort fails before sending requests; non-thinking models omit effort', async () => {
    settings.reasoningEffort = 'max';
    global.fetch = () => { throw new Error('Unexpected request'); };
    const invalid = await diagnoseResponses(account, model, new AbortController().signal);
    assert.equal(invalid[0].status, 'FAIL');
    const bodies = [];
    global.fetch = async (_, init) => {
        const body = JSON.parse(init.body); bodies.push(body);
        return body.stream ? sse('stop') : json(answer('stop'));
    };
    await diagnoseResponses(account, { ...model, thinking: false }, new AbortController().signal);
    assert.ok(bodies.every(body => body.thinking.type === 'disabled' && !('reasoning_effort' in body)));
});

test('HTTP success alone does not pass, and output truncation is reported as a warning', async () => {
    global.fetch = async (_, init) => JSON.parse(init.body).stream ? new Response('data: [DONE]\n\n') : json({});
    const empty = await diagnoseResponses(account, model, new AbortController().signal);
    assert.deepEqual(empty.slice(1).map(check => check.status), ['FAIL', 'FAIL']);
    global.fetch = async (_, init) => JSON.parse(init.body).stream ? sse('length') : json(answer('length'));
    const truncated = await diagnoseResponses(account, model, new AbortController().signal);
    assert.deepEqual(truncated.slice(1).map(check => check.status), ['WARN', 'WARN']);
    global.fetch = async (_, init) => JSON.parse(init.body).stream ? sse(null) : json(answer(null));
    const incomplete = await diagnoseResponses(account, model, new AbortController().signal);
    assert.ok(incomplete.slice(1).every(check => check.status === 'FAIL'));
});

test('response-body timeout aborts each check and sanitizes failures', async () => {
    const signals = [];
    global.fetch = async (_, init) => {
        signals.push(init.signal);
        return new Response(new ReadableStream({ start(controller) {
            init.signal.addEventListener('abort', () => controller.error(new DOMException('secret server detail', 'AbortError')));
        } }));
    };
    const checks = await diagnoseResponses(account, model, new AbortController().signal, () => {}, 15);
    assert.equal(signals.length, 2);
    assert.ok(signals.every(signal => signal.aborted));
    assert.ok(checks.slice(1).every(check => check.status === 'FAIL' && check.detail.includes('Timed out')));
    assert.ok(!JSON.stringify(checks).includes('secret server detail'));
});

test('cancellation during the first response body aborts its read and skips subsequent checks', async () => {
    const controller = new AbortController();
    let requests = 0;
    global.fetch = async (_, init) => {
        requests++;
        return new Response(new ReadableStream({ start(body) {
            init.signal.addEventListener('abort', () => body.error(new DOMException('Aborted', 'AbortError')));
            setTimeout(() => controller.abort(), 10);
        } }));
    };
    const checks = await diagnoseResponses(account, model, controller.signal);
    assert.equal(requests, 1);
    assert.deepEqual(checks.slice(1).map(check => check.status), ['CANCELLED', 'CANCELLED']);
    assert.match(checks[2].detail, /no further request/);
});

test('VS Code cancellation stays registered until stream body finishes', async () => {
    let cancel, disposed = false;
    const cancellationToken = { isCancellationRequested: false, onCancellationRequested(fn) {
        cancel = fn; return { dispose() { disposed = true; } };
    } };
    global.fetch = async (_, init) => new Response(new ReadableStream({ start(body) {
        init.signal.addEventListener('abort', () => body.error(new DOMException('Aborted', 'AbortError')));
        setTimeout(() => { assert.equal(disposed, false); cancel(); }, 10);
    } }));
    await assert.rejects(async () => {
        for await (const _ of new KimiApiClient(account.apiKey).streamChat(model.id, [], account.baseUrl, {}, cancellationToken)) {}
    }, { name: 'AbortError' });
    assert.equal(disposed, true);
});

test('report removes key, encoded key and URL credentials/query/fragment', () => {
    const secretAccount = { ...account, baseUrl: `https://user:password@example.com/${encodeURIComponent(account.apiKey)}?token=another-secret#fragment` };
    const report = formatDiagnosticReport(secretAccount, { ...model, id: account.apiKey }, [{ name: 'Discovery', status: 'FAIL', detail: account.apiKey }]);
    for (const secret of [account.apiKey, encodeURIComponent(account.apiKey), 'password', 'another-secret', 'fragment']) {
        // "fragment" also appears in the static privacy statement, so inspect URL only.
        assert.ok(!report.split('\n').find(line => line.startsWith('Endpoint:')).includes(secret));
    }
    assert.ok(!report.includes(account.apiKey));
    assert.ok(!report.includes(encodeURIComponent(account.apiKey)));
});

test('provider diagnostic snapshot follows endpoint changes and explicit credential removal', async () => {
    global.fetch = async () => json(payload);
    const provider = new KimiChatProvider();
    assert.equal(provider.diagnosticConfiguration, undefined);
    await provider.provideLanguageModelChatInformation({ modelConfiguration: { apiKey: account.apiKey } }, token);
    assert.equal(provider.diagnosticConfiguration.account.apiKey, account.apiKey);
    assert.equal(provider.diagnosticConfiguration.models[0].id, model.id);
    settings.endpoint = 'kimiCodeCN';
    assert.equal(provider.diagnosticConfiguration.account.baseUrl, 'https://api.kimi.com/coding/v1');
    assert.deepEqual(provider.diagnosticConfiguration.models, []);
    await provider.provideLanguageModelChatInformation({ modelConfiguration: { apiKey: '' } }, token);
    assert.equal(provider.diagnosticConfiguration, undefined);
    provider.dispose();
});

test('command guides unconfigured users, honors picker dismissal, and offers a sanitized report', async () => {
    await runConfigurationDiagnostics({ diagnosticConfiguration: undefined }, output);
    assert.match(notifications[0], /Manage Language Models/);
    assert.equal(reports.length, 0);
    const requests = [];
    global.fetch = async (url, init) => {
        requests.push(url);
        if (url.endsWith('/models')) return json(payload);
        return JSON.parse(init.body).stream ? sse('stop') : json(answer('stop'));
    };
    const provider = { diagnosticConfiguration: { account, models: [model] } };
    selection = false;
    await runConfigurationDiagnostics(provider, output);
    assert.deepEqual(requests, [account.baseUrl + '/models']);
    assert.equal(reports.length, 0);
    selection = 0;
    await runConfigurationDiagnostics(provider, output);
    assert.match(notifications.at(-1), /passed/);
    assert.equal(copied, reports[0]);
    assert.ok(!copied.includes(account.apiKey));
    assert.match(copied, /selected-model/);
});

test('new command and legacy alias share one run, and a later invocation starts a fresh run', async () => {
    const registered = new Map();
    let resolveRun, calls = 0;
    const previousLoad = Module._load;
    const mockProvider = class {
        onDidChangeAccount() { return { dispose() {} }; }
    };
    Module._load = function(id, parent, ...args) {
        if (parent?.filename.endsWith('extension.js')) {
            if (id === './diagnostics') return { runConfigurationDiagnostics() {
                calls++; return new Promise(resolve => { resolveRun = resolve; });
            } };
            if (id === './provider') return { KimiChatProvider: mockProvider };
            if (id === './usage') return { UsageStatusBar: class {} };
        }
        return previousLoad.call(this, id, parent, ...args);
    };
    vscode.commands = { registerCommand(id, handler) { registered.set(id, handler); return { dispose() {} }; } };
    vscode.window.createOutputChannel = () => ({ ...output, dispose() {} });
    vscode.workspace.onDidChangeConfiguration = () => ({ dispose() {} });
    vscode.lm.registerLanguageModelChatProvider = () => ({ dispose() {} });
    try {
        require('../out/extension.js').activate({ subscriptions: [], globalState: undefined });
        const first = registered.get('kimi.diagnoseConfiguration')();
        const alias = registered.get('kimi.testConnection')();
        assert.equal(first, alias);
        assert.equal(calls, 1);
        resolveRun(); await first;
        const next = registered.get('kimi.testConnection')();
        assert.equal(calls, 2);
        resolveRun(); await next;
    } finally { Module._load = previousLoad; }
});
