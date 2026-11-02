const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = file => readFileSync(join(__dirname, '..', file), 'utf8');
// Everything after the marker wires the modules into the page; the tests drive the classes directly.
const withoutBootstrap = file => read(file).split('// --- bootstrap')[0];

const USER = { id: 'u1', email: 'rider@example.com', name: 'Alex', emailVerified: true };
const PROFILE = { riderName: 'Alex', ftp: 250, hrConsentAt: null };
const profileWith = changes => ({ user: USER, profile: { ...PROFILE, ...changes } });

// `routes(call)` answers each request with { status?, body?, headers? } or throws to simulate a dead network.
function harness(routes = () => ({ status: 404 })) {
    const calls = [];
    const timers = new Map();
    const storage = new Map();
    const elements = new Map();
    const replaced = [];
    let nextTimer = 0;
    const element = () => ({
        open: false, value: '', returnValue: '', style: {}, children: new Map(),
        showModal() { this.open = true; }, close() { this.open = false; },
        addEventListener() {}, querySelector() { return null; }, focus() {}
    });
    const setTimer = (callback, delay, repeat = false) => {
        timers.set(++nextTimer, { callback, delay, repeat });
        return nextTimer;
    };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        URLSearchParams, AbortController, crypto: globalThis.crypto,
        setTimeout: (fn, ms) => setTimer(fn, ms), clearTimeout: id => timers.delete(id),
        setInterval: (fn, ms) => setTimer(fn, ms, true), clearInterval: id => timers.delete(id),
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        },
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, element());
                return elements.get(id);
            },
            createElement: element,
            addEventListener(type, callback) { if (type === 'alpine:init') callback(); }
        },
        navigator: {}, addEventListener() {},
        lucide: { createIcons() {} }
    });
    context.window = context;
    context.location = { search: '', pathname: '/', hash: '#ride' };
    context.history = { replaceState: (...args) => replaced.push(args) };
    const stores = {};
    context.Alpine = { store(name, value) { if (value) stores[name] = value; return stores[name]; } };
    const load = source => vm.runInContext(source, context);
    load(`${read('alpine-store.js')}`);
    delete context.Alpine; // the managers only touch Alpine through an explicit state in these tests
    load(`${read('workout-recorder.js')}\nglobalThis.WorkoutRecorder = WorkoutRecorder;`);
    load(`${withoutBootstrap('account.js')}
        globalThis.AccountManager = AccountManager; globalThis.RideQueue = RideQueue; globalThis.ApiError = ApiError;
        globalThis.describeError = describeError;`);
    load(`${withoutBootstrap('history.js')}
        globalThis.RideHistory = RideHistory; globalThis.reduceSamples = reduceSamples; globalThis.formatRide = formatRide;`);

    const fetch = async (path, init = {}) => {
        const call = { method: init.method || 'GET', path, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
        calls.push(call);
        const reply = await routes(call);
        const status = reply.status ?? 200;
        const text = reply.body === undefined ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
        return {
            ok: status >= 200 && status < 300, status, text: async () => text,
            headers: { get: name => (reply.headers && reply.headers[name]) ?? null }
        };
    };
    const freshState = () => JSON.parse(JSON.stringify(stores.app.account));
    const freshHistoryState = () => JSON.parse(JSON.stringify(stores.app.rideHistory));
    const manager = (options = {}) => {
        const state = options.state || freshState();
        state.available = true;
        return new context.AccountManager({
            fetch, state, queue: new context.RideQueue(null), askConsent: async () => true,
            captcha: { consume: async () => null, mount: async () => {}, unmount() {} }, ...options
        });
    };
    return { context, calls, timers, storage, elements, replaced, stores, fetch, manager, freshState, freshHistoryState };
}

const posts = (calls, path) => calls.filter(call => call.method === 'POST' && call.path === path);

function recorder(h, points, startTime = new Date('2026-11-02T07:30:00.000Z')) {
    const rec = new h.context.WorkoutRecorder();
    rec.startTime = startTime;
    rec.workoutName = 'Sweet Spot 3x10';
    rec.dataPoints = points.map(([elapsedSeconds, power, heartRate, cadence]) => ({ elapsedSeconds, power, heartRate, cadence }));
    return rec;
}

const ride = (id = 'ride-1', hr = 140) => ({
    id, startedAt: '2026-11-02T07:30:00.000Z', workoutName: 'Test', ftp: 250, groupSession: false,
    samples: [[0, 100, hr, 80], [1, 110, hr, 82]]
});

test('recordings are reduced to 1 Hz with the last reading per second', () => {
    const h = harness();
    const rec = recorder(h, [
        [0.1, 100, 90, 80], [0.5, 120, 91, 81], [0.9, 140, 92, 82], // second 0: keeps 140
        [1.2, 150, 93, 83],
        [3.4, 160.6, 94.4, 84], [3.9, 170.4, 95, 85], // gap at second 2; second 3 keeps 170
        [4.0, 3500, 300, 400] // out-of-range values are clamped
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(rec.getUploadSamples())), [
        [0, 140, 92, 82], [1, 150, 93, 83], [3, 170, 95, 85], [4, 3000, 250, 250]
    ]);
    assert.deepEqual(rec.getUploadSamples(2).length, 2);
    assert.equal(recorder(h, []).getUploadSamples().length, 0);
});

test('the upload payload follows the contract and carries no statistics', () => {
    const h = harness();
    const rec = recorder(h, [[0, 100, 0, 80], [1, 110, 0, 82]]);
    const payload = rec.buildRidePayload({ ftp: 249.6, groupSession: true });
    assert.match(payload.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(Object.keys(payload).sort(), ['ftp', 'groupSession', 'id', 'samples', 'startedAt', 'workoutName']);
    assert.equal(payload.startedAt, '2026-11-02T07:30:00.000Z');
    assert.equal(payload.workoutName, 'Sweet Spot 3x10');
    assert.equal(payload.ftp, 250);
    assert.equal(payload.groupSession, true);
    assert.notEqual(rec.buildRidePayload().id, payload.id);
    assert.equal(rec.buildRidePayload({ ftp: 30 }).ftp, null);
    assert.equal(rec.buildRidePayload({ ftp: 900 }).ftp, null);
    rec.workoutName = 'x'.repeat(150);
    assert.equal(rec.buildRidePayload().workoutName.length, 100);
    assert.equal(recorder(h, []).buildRidePayload(), null);
});

test('without a working backend the account features stay off and nothing else is requested', async () => {
    for (const reply of [{ status: 404 }, { status: 200, body: '<!doctype html>' }, { status: 200, body: { status: 'down' } }]) {
        const h = harness(() => reply);
        const state = h.freshState();
        const account = h.manager({ state });
        state.available = false;
        await account.init();
        assert.equal(state.available, false);
        assert.deepEqual(h.calls.map(call => call.path), ['/api/health']);
        assert.equal(await account.saveRide(ride()), 'unavailable');
        assert.equal(state.saveStatus, '');
        assert.equal(h.calls.length, 1);
        assert.equal(h.stores.app.signedIn, false);
    }
    const offline = harness(() => { throw new Error('offline'); });
    const state = offline.freshState();
    const account = offline.manager({ state });
    state.available = false;
    await account.init();
    assert.equal(state.available, false);
});

test('every account element in the page is gated on the backend being available', () => {
    const html = read('index.html');
    const tag = id => new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`, 's').exec(html)[0];
    assert.match(tag('accountButton'), /x-show="\$store\.app\.account\.available"/);
    assert.match(tag('accountButton'), /x-cloak/);
    assert.match(tag('nav-history'), /x-show="\$store\.app\.signedIn"/);
    assert.match(tag('nav-history'), /x-cloak/);
    assert.match(read('alpine-store.js'), /get signedIn\(\) \{\s*return this\.account\.available && Boolean\(this\.account\.user\)/);
});

test('start-up with a backend loads the signed-in user and applies the profile to the app', async () => {
    const h = harness(call => {
        if (call.path === '/api/health') return { body: { status: 'ok', version: 'dev' } };
        if (call.path === '/api/me') return { body: profileWith({ ftp: 280 }) };
        return { status: 404 };
    });
    const designer = { isRunning: false, ftp: 200, setFTP(ftp) { this.ftp = ftp; } };
    h.context.workoutDesigner = designer;
    const state = h.freshState();
    const account = h.manager({ state });
    state.available = false;
    await account.init();
    assert.equal(state.available, true);
    assert.equal(state.user.email, 'rider@example.com');
    assert.equal(designer.ftp, 280);
    assert.equal(h.storage.get('riderName'), 'Alex');
    assert.equal(h.elements.get('ftpInput').value, 280);
    assert.equal(h.elements.get('quickJoinName').value, 'Alex');
    // A running workout keeps its targets.
    designer.isRunning = true;
    state.profile.ftp = 150;
    account.applyProfileToApp();
    assert.equal(designer.ftp, 280);
});

test('a ride finished while signed out waits in memory and uploads after sign-in', async () => {
    let signedIn = false;
    const h = harness(call => {
        if (call.path === '/api/me') return signedIn ? { body: profileWith({}) } : { status: 401, body: { error: 'unauthenticated' } };
        if (call.path === '/api/rides') return { status: 201, body: {} };
        return { status: 404 };
    });
    const state = h.freshState();
    const account = h.manager({ state });
    assert.equal(await account.saveRide(ride('guest-ride')), 'login');
    assert.equal(state.saveStatus, 'login');
    assert.equal(state.saveMessage, 'Sign in to save this ride');
    assert.equal(posts(h.calls, '/api/rides').length, 0);
    signedIn = true;
    await account.finishSignIn();
    assert.equal(state.user.id, 'u1');
    assert.equal(posts(h.calls, '/api/rides').length, 1);
    assert.equal(posts(h.calls, '/api/rides')[0].body.id, 'guest-ride');
    assert.equal(state.saveStatus, 'saved');
    assert.equal(account.guestRide, null);
});

test('a signed-in ride uploads once and reports that it is in the history', async () => {
    const h = harness(call => (call.path === '/api/rides' ? { status: 201, body: {} } : { status: 404 }));
    const state = h.freshState();
    state.user = USER;
    state.profile = PROFILE;
    const account = h.manager({ state });
    let saved = 0;
    account.on('rideSaved', () => saved++);
    assert.equal(await account.saveRide(ride()), 'saved');
    assert.equal(state.saveStatus, 'saved');
    assert.equal(state.saveMessage, 'Saved to your history');
    assert.equal(saved, 1);
    assert.equal(h.calls[0].headers['Content-Type'], 'application/json');
});

test('428 asks for heart-rate consent, stores it, and retries the same ride id', async () => {
    let consented = false;
    const h = harness(call => {
        if (call.path === '/api/me' && call.method === 'PUT') {
            consented = true;
            return { body: profileWith({ hrConsentAt: '2026-11-02T10:00:00.000Z' }) };
        }
        if (call.path === '/api/rides') return consented ? { status: 201, body: {} } : { status: 428, body: { error: 'hr_consent_required' } };
        return { status: 404 };
    });
    const state = h.freshState();
    state.user = USER;
    state.profile = PROFILE;
    let asked = 0;
    const account = h.manager({ state, askConsent: async () => { asked++; return true; } });
    assert.equal(await account.saveRide(ride('r1')), 'saved');
    assert.equal(asked, 1);
    assert.deepEqual(h.calls.map(call => `${call.method} ${call.path}`), ['POST /api/rides', 'PUT /api/me', 'POST /api/rides']);
    assert.deepEqual(h.calls[1].body, { hrConsent: true });
    assert.equal(h.calls[2].body.id, 'r1');
    assert.deepEqual(h.calls[2].body.samples[0], [0, 100, 140, 80]);
    assert.equal(state.profile.hrConsentAt, '2026-11-02T10:00:00.000Z');
    assert.equal(state.saveStatus, 'saved');
});

test('declining consent uploads the ride with heart rate set to 0', async () => {
    const h = harness(call => {
        if (call.path !== '/api/rides') return { status: 404 };
        const hasHr = call.body.samples.some(sample => sample[2] > 0);
        return hasHr ? { status: 428, body: { error: 'hr_consent_required' } } : { status: 201, body: {} };
    });
    const state = h.freshState();
    state.user = USER;
    state.profile = PROFILE;
    const account = h.manager({ state, askConsent: async () => false });
    assert.equal(await account.saveRide(ride()), 'saved');
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls.some(call => call.method === 'PUT'), false);
    assert.deepEqual(h.calls[1].body.samples, [[0, 100, 0, 80], [1, 110, 0, 82]]);
    assert.equal(state.profile.hrConsentAt, null);
});

test('network failures and server errors queue the ride; the next flush uploads it', async () => {
    for (const failure of [() => { throw new Error('offline'); }, () => ({ status: 503, body: { error: 'internal' } })]) {
        let online = false;
        const h = harness(call => {
            if (call.path !== '/api/rides') return { status: 404 };
            return online ? { status: 201, body: {} } : failure();
        });
        const state = h.freshState();
        state.user = USER;
        state.profile = PROFILE;
        const account = h.manager({ state });
        assert.equal(await account.saveRide(ride('queued-1')), 'queued');
        assert.equal(state.saveStatus, 'queued');
        assert.equal(state.saveMessage, 'Saved offline, will sync');
        const entries = await account.queue.all();
        assert.equal(entries.length, 1);
        assert.equal(entries[0].id, 'queued-1');
        assert.equal(entries[0].userId, 'u1');

        await account.flushQueue(); // still offline: entry stays
        assert.equal((await account.queue.all()).length, 1);
        assert.equal(state.saveStatus, 'queued');

        online = true;
        await account.flushQueue();
        assert.equal((await account.queue.all()).length, 0);
        assert.equal(state.saveStatus, 'saved');
    }
});

test('queued rides are dropped on final 4xx errors and kept for 401, 428, 429 and 5xx', async () => {
    const cases = [
        [400, false], [409, false], [413, false], [403, false], [404, false],
        [401, true], [428, true], [429, true], [500, true], [503, true]
    ];
    for (const [status, kept] of cases) {
        const h = harness(call => (call.path === '/api/rides' ? { status, body: { error: 'x' } } : { status: 404 }));
        const state = h.freshState();
        state.user = USER;
        state.profile = PROFILE;
        const account = h.manager({ state });
        await account.queue.put({ id: 'q', userId: 'u1', payload: ride('q'), queuedAt: 1 });
        await account.flushQueue();
        assert.equal((await account.queue.all()).length, kept ? 1 : 0, `status ${status}`);
    }
});

test('a flush stops at the first connection problem and only sends the signed-in user\'s rides', async () => {
    const h = harness(call => {
        if (call.path !== '/api/rides') return { status: 404 };
        if (call.body.id === 'b') throw new Error('offline');
        return { status: 201, body: {} };
    });
    const state = h.freshState();
    state.user = USER;
    state.profile = PROFILE;
    const account = h.manager({ state });
    await account.queue.put({ id: 'a', userId: 'u1', payload: ride('a'), queuedAt: 1 });
    await account.queue.put({ id: 'b', userId: 'u1', payload: ride('b'), queuedAt: 2 });
    await account.queue.put({ id: 'c', userId: 'u1', payload: ride('c'), queuedAt: 3 });
    await account.queue.put({ id: 'x', userId: 'someone-else', payload: ride('x'), queuedAt: 0 });
    await account.flushQueue();
    assert.deepEqual(h.calls.map(call => call.body.id), ['a', 'b']); // x belongs to another user, c waits behind b
    assert.deepEqual(Array.from((await account.queue.all()).map(entry => entry.id)).sort(), ['b', 'c', 'x']);
});

test('a session that ended during upload keeps the ride for the next sign-in', async () => {
    const h = harness(call => (call.path === '/api/rides' ? { status: 401, body: { error: 'unauthenticated' } } : { status: 404 }));
    const state = h.freshState();
    state.user = USER;
    state.profile = PROFILE;
    const account = h.manager({ state });
    assert.equal(await account.saveRide(ride('r')), 'login');
    assert.equal(state.user, null);
    assert.equal(state.saveStatus, 'login');
    const entries = await account.queue.all();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].userId, 'u1');
});

test('a rejected ride is reported and not retried', async () => {
    const h = harness(call => (call.path === '/api/rides' ? { status: 400, body: { error: 'invalid_request', message: 'samples must be sorted' } } : { status: 404 }));
    const state = h.freshState();
    state.user = USER;
    state.profile = PROFILE;
    const account = h.manager({ state });
    assert.equal(await account.saveRide(ride()), 'error');
    assert.equal(state.saveStatus, 'error');
    assert.match(state.saveMessage, /samples must be sorted/);
    assert.equal((await account.queue.all()).length, 0);
});

test('sign-in asks for the e-mail code, sends the captcha token only where required, and honours the resend cooldown', async () => {
    const h = harness(call => {
        if (call.path === '/api/auth/sign-in/email') return { body: { twoFactorRedirect: true } };
        if (call.path === '/api/auth/two-factor/send-otp') return { body: {} };
        if (call.path === '/api/auth/two-factor/verify-otp') {
            return call.body.code === '123456' ? { body: {} } : { status: 401, body: { error: 'INVALID_CODE' } };
        }
        if (call.path === '/api/me') return { body: profileWith({}) };
        return { status: 404 };
    });
    const state = h.freshState();
    const account = h.manager({ state, captcha: { consume: async () => 'turnstile-token', mount: async () => {}, unmount() {} } });
    Object.assign(state.ui.form, { email: ' rider@example.com ', password: 'correct horse' });
    await account.signIn();
    assert.deepEqual(h.calls[0].body, { email: 'rider@example.com', password: 'correct horse', rememberMe: true });
    assert.equal(h.calls[0].headers['x-captcha-response'], 'turnstile-token');
    assert.equal(h.calls[1].path, '/api/auth/two-factor/send-otp');
    assert.equal(h.calls[1].headers['x-captcha-response'], undefined);
    assert.equal(state.ui.view, 'code');
    assert.equal(state.ui.form.password, '');
    assert.equal(state.ui.cooldown, 30);

    assert.equal(await account.resendCode(), false); // cooling down
    assert.equal(posts(h.calls, '/api/auth/two-factor/send-otp').length, 1);
    const tick = [...h.timers.values()].find(timer => timer.repeat);
    for (let i = 0; i < 30; i++) tick.callback();
    assert.equal(state.ui.cooldown, 0);
    await account.resendCode();
    assert.equal(posts(h.calls, '/api/auth/two-factor/send-otp').length, 2);

    state.ui.form.code = '12';
    await account.verifyCode();
    assert.equal(state.ui.error, 'Enter the 6-digit code from your email.');
    state.ui.form.code = '000000';
    await account.verifyCode();
    assert.match(state.ui.error, /wrong or has expired/);
    assert.equal(state.user, null);
    state.ui.form.code = '123 456';
    state.ui.form.trustDevice = false;
    await account.verifyCode();
    const verify = posts(h.calls, '/api/auth/two-factor/verify-otp').at(-1);
    assert.deepEqual(verify.body, { code: '123456', trustDevice: false });
    assert.equal(state.user.email, 'rider@example.com');
});

test('an unverified e-mail leads to the "check your inbox" step with a resend', async () => {
    const h = harness(call => {
        if (call.path === '/api/auth/sign-in/email') return { status: 403, body: { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' } };
        if (call.path === '/api/auth/send-verification-email') return { body: {} };
        return { status: 404 };
    });
    const state = h.freshState();
    const account = h.manager({ state });
    Object.assign(state.ui.form, { email: 'new@example.com', password: 'correct horse' });
    await account.signIn();
    assert.equal(state.ui.view, 'verify');
    assert.equal(state.ui.pendingEmail, 'new@example.com');
    await account.resendVerification();
    assert.deepEqual(h.calls.at(-1).body, { email: 'new@example.com', callbackURL: '/?verified=1' });
    assert.equal(state.ui.cooldown, 30);
});

test('sign-up validates locally, then asks the user to verify their e-mail', async () => {
    const h = harness(call => (call.path === '/api/auth/sign-up/email' ? { body: {} } : { status: 404 }));
    const state = h.freshState();
    const account = h.manager({ state });
    Object.assign(state.ui.form, { name: 'Alex', email: 'a@example.com', password: 'short' });
    await account.signUp();
    assert.match(state.ui.error, /10/);
    assert.equal(h.calls.length, 0);
    state.ui.form.password = 'long enough password';
    await account.signUp();
    assert.deepEqual(h.calls[0].body, { email: 'a@example.com', password: 'long enough password', name: 'Alex', callbackURL: '/?verified=1' });
    assert.equal(state.ui.view, 'verify');
});

test('e-mail links open the right view and are removed from the address bar', () => {
    const h = harness();
    const open = (search, signedIn = false) => {
        h.context.location.search = search;
        h.replaced.length = 0;
        const state = h.freshState();
        if (signedIn) state.user = USER;
        h.manager({ state }).handleUrlParams();
        return state.ui;
    };
    let ui = open('?verified=1');
    assert.equal(ui.view, 'signin');
    assert.match(ui.notice, /verified/);
    assert.deepEqual(h.replaced[0], [null, '', '/#ride']);
    ui = open('?reset=1&token=abc');
    assert.equal(ui.view, 'reset');
    assert.equal(ui.resetToken, 'abc');
    ui = open('?reset=1&error=INVALID_TOKEN');
    assert.equal(ui.view, 'forgot');
    assert.match(ui.error, /expired/);
    ui = open('?verified=1', true);
    assert.equal(ui.view, 'menu');
    h.replaced.length = 0;
    open('');
    assert.equal(h.replaced.length, 0);
});

test('password reset sends the token from the link and returns to sign-in', async () => {
    const h = harness(call => (call.path === '/api/auth/reset-password' ? { body: {} } : { status: 404 }));
    const state = h.freshState();
    const account = h.manager({ state });
    state.ui.resetToken = 'tok';
    state.ui.form.newPassword = 'short';
    await account.resetPassword();
    assert.equal(h.calls.length, 0);
    state.ui.form.newPassword = 'a much longer password';
    await account.resetPassword();
    assert.deepEqual(h.calls[0].body, { newPassword: 'a much longer password', token: 'tok' });
    assert.equal(state.ui.view, 'signin');
    assert.match(state.ui.notice, /Password changed/);
});

test('profile changes go to PUT /api/me only when something changed', async () => {
    const h = harness(call => (call.method === 'PUT' ? { body: profileWith(call.body) } : { status: 404 }));
    const state = h.freshState();
    state.user = USER;
    state.profile = PROFILE;
    const account = h.manager({ state });
    account.fillProfileForm();
    await account.saveProfile();
    assert.equal(h.calls.length, 0);
    Object.assign(state.ui.form, { riderName: 'Speedy', ftp: '300', hrConsent: true });
    await account.saveProfile();
    assert.deepEqual(h.calls[0].body, { riderName: 'Speedy', ftp: 300, hrConsent: true });
    state.ui.form.ftp = '20';
    await account.saveProfile();
    assert.match(state.ui.error, /between 50 and 500/);
    await account.pushProfile({ ftp: 300 }); // unchanged: no request
    await account.pushProfile({ ftp: 310 });
    assert.deepEqual(h.calls.at(-1).body, { ftp: 310 });
    assert.equal(h.calls.length, 2);
});

test('deleting the account needs the password and clears local state and queued rides', async () => {
    const h = harness(call => {
        if (call.method === 'DELETE') return call.body.password === 'right' ? { body: {} } : { status: 403, body: { error: 'forbidden' } };
        return { status: 404 };
    });
    const state = h.freshState();
    state.user = USER;
    state.profile = PROFILE;
    const account = h.manager({ state });
    await account.queue.put({ id: 'q', userId: 'u1', payload: ride('q'), queuedAt: 1 });
    await account.deleteAccount();
    assert.equal(h.calls.length, 0);
    Object.assign(state.ui.form, { deletePassword: 'wrong', deleteConfirm: true });
    await account.deleteAccount();
    assert.equal(state.ui.error, 'That password is not correct.');
    assert.ok(state.user);
    state.ui.form.deletePassword = 'right';
    await account.deleteAccount();
    assert.equal(state.user, null);
    assert.equal((await account.queue.all()).length, 0);
});

test('error messages are short and specific', () => {
    const h = harness();
    const error = (status, code, message) => new h.context.ApiError(status, code, message);
    const say = (err, context) => h.context.describeError(err, context);
    assert.match(say(error(0, 'network')), /Can't reach the server/);
    assert.match(say(error(429, 'rate_limited')), /Too many attempts/);
    assert.match(say(error(403, 'EMAIL_NOT_VERIFIED')), /verify your email/);
    assert.match(say(error(401, 'INVALID_OTP'), 'code'), /wrong or has expired/);
    assert.match(say(error(401, 'x'), 'signin'), /Email or password is incorrect/);
    assert.match(say(error(403, 'x'), 'delete'), /password is not correct/);
    assert.match(say(error(422, 'USER_ALREADY_EXISTS')), /already exists/);
    assert.equal(say(error(400, 'invalid_request', 'Name is too long')), 'Name is too long');
    assert.equal(say(new Error('boom')), 'Something went wrong. Please try again.');
});

test('history helpers: sample reduction keeps duration and ignores zeros; ride text stays plain text', () => {
    const h = harness();
    const samples = Array.from({ length: 1000 }, (_, i) => [i, 200, i % 2 ? 0 : 140, 90]);
    const reduced = h.context.reduceSamples(samples, 100);
    assert.equal(reduced.length, 100);
    assert.equal(reduced[0][0], 0);
    assert.ok(reduced.every(point => point[1] === 200 && point[2] === 140 && point[3] === 90));
    assert.equal(h.context.reduceSamples(samples.slice(0, 5), 100).length, 5);

    const formatted = h.context.formatRide({
        id: 'r', startedAt: '2026-11-02T07:30:00.000Z', durationS: 3725, workoutName: '<img src=x onerror=alert(1)>',
        ftp: 250, avgPower: 190, maxPower: 410, avgHr: null, maxHr: null, avgCadence: 88, workKj: 684, np: null, tss: 67.24, groupSession: false
    });
    assert.equal(formatted.workoutName, '<img src=x onerror=alert(1)>'); // rendered with x-text, never innerHTML
    assert.equal(formatted.durationLabel, '1:02:05');
    assert.equal(formatted.powerLabel, '190 / — W');
    assert.equal(formatted.hrLabel, '—');
    assert.equal(formatted.tssLabel, '67');
    assert.doesNotMatch(read('index.html').split('id="content-history"')[1].split('id="accountDialog"')[0], /x-html|innerHTML/);
});

test('ride history loads stats and pages, and deleting a ride refreshes the totals', async () => {
    const week = { rides: 1, durationS: 3600, workKj: 700, tss: 60.5 };
    const summary = id => ({ id, startedAt: '2026-11-02T07:30:00.000Z', durationS: 600, workoutName: id, avgPower: 150, np: 160, tss: 10, avgHr: 120, groupSession: false });
    const h = harness(call => {
        if (call.path === '/api/stats') return { body: { thisWeek: week, thisMonth: week, weeks: [{ weekStart: '2026-10-26', ...week }] } };
        if (call.path === '/api/rides?limit=20') return { body: { rides: [summary('a'), summary('b')], nextCursor: 'cur 1' } };
        if (call.path === '/api/rides?limit=20&cursor=cur%201') return { body: { rides: [summary('c')], nextCursor: null } };
        if (call.method === 'DELETE') return { status: 204 };
        return { status: 404 };
    });
    const account = h.manager();
    const state = h.freshHistoryState();
    const history = new h.context.RideHistory(account, { state });
    await history.load();
    assert.equal(state.loaded, true);
    assert.deepEqual(Array.from(state.rides.map(item => item.id)), ['a', 'b']);
    assert.equal(state.stats.week.time, '1h 00m');
    assert.equal(state.stats.week.tss, '61');
    await history.loadMore();
    assert.deepEqual(Array.from(state.rides.map(item => item.id)), ['a', 'b', 'c']);
    assert.equal(state.nextCursor, null);
    state.selected = state.rides[0];
    await history.confirmDelete();
    assert.deepEqual(Array.from(state.rides.map(item => item.id)), ['b', 'c']);
    assert.equal(state.selected, null);
    assert.equal(h.calls.filter(call => call.path === '/api/stats').length, 2);
});
