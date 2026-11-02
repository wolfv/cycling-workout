// Accounts and ride upload. Talks to the optional /api backend described in docs/api.md.
// Without a working GET /api/health every account element stays hidden and the app behaves as before.

const RESEND_COOLDOWN_SECONDS = 30;
// The contract leaves open whether sign-in already emails the code. Better Auth does not, so we ask for it.
const SEND_CODE_AFTER_SIGN_IN = true;
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;

class ApiError extends Error {
    constructor(status, code, message) {
        super(message || code || 'Request failed');
        this.name = 'ApiError';
        this.status = status; // 0 = the request never reached the server
        this.code = code || '';
    }
}

// Short, human messages for the dialogs. `context` narrows what a 401/403 means.
function describeError(error, context = '') {
    if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
    const code = String(error.code || '').toUpperCase();
    if (code === 'CAPTCHA') return error.message;
    if (error.status === 0) return "Can't reach the server. Check your connection and try again.";
    if (error.status === 429 || code === 'RATE_LIMITED') return 'Too many attempts. Please wait a minute and try again.';
    if (code === 'EMAIL_NOT_VERIFIED') return 'Please verify your email address first. Check your inbox.';
    if (/CAPTCHA|MISSING_RESPONSE|VERIFICATION_FAILED/.test(code)) return 'The bot check failed. Please try again.';
    if (context === 'code' && (error.status === 401 || error.status === 400)) {
        return 'That code is wrong or has expired. Check it, or request a new one.';
    }
    if (context === 'signin' && (error.status === 401 || code === 'INVALID_EMAIL_OR_PASSWORD')) {
        return 'Email or password is incorrect.';
    }
    if (context === 'delete' && error.status === 403) return 'That password is not correct.';
    if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
        return 'An account with this email already exists. Try signing in.';
    }
    if (code === 'INVALID_TOKEN') return 'This link has expired. Please request a new one.';
    if (error.status === 401) return 'Your session has expired. Please sign in again.';
    if (error.status === 413) return 'That is too large to upload.';
    return error.message || 'Something went wrong. Please try again.';
}

// Network trouble, timeouts, rate limits and server errors may pass; everything else is final.
function isRetryableStatus(status) {
    return status === 0 || status === 408 || status === 429 || status >= 500;
}

function withoutHeartRate(payload) {
    return { ...payload, samples: payload.samples.map(sample => [sample[0], sample[1], 0, sample[3]]) };
}

// Rides waiting for a connection. Kept in IndexedDB so they survive a reload.
class IndexedDbRideStore {
    constructor(factory = globalThis.indexedDB) {
        this.factory = factory;
        this.dbPromise = null;
    }

    open() {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                const request = this.factory.open('cadence-account', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('rideQueue', { keyPath: 'id' });
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return this.dbPromise;
    }

    async run(mode, action) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('rideQueue', mode);
            const request = action(transaction.objectStore('rideQueue'));
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }

    put(entry) { return this.run('readwrite', store => store.put(entry)); }
    all() { return this.run('readonly', store => store.getAll()); }
    remove(id) { return this.run('readwrite', store => store.delete(id)); }
}

class MemoryRideStore {
    constructor() { this.items = new Map(); }
    async put(entry) { this.items.set(entry.id, entry); }
    async all() { return [...this.items.values()]; }
    async remove(id) { this.items.delete(id); }
}

// IndexedDB can be blocked (private mode, storage off); the memory store keeps the queue working until reload.
class RideQueue {
    constructor(store = null) {
        this.store = store;
        this.memory = new MemoryRideStore();
    }

    async put(entry) {
        try {
            if (this.store) return await this.store.put(entry);
        } catch (error) {
            console.warn('Ride queue storage unavailable:', error);
        }
        return this.memory.put(entry);
    }

    async all() {
        let stored = [];
        try {
            if (this.store) stored = await this.store.all();
        } catch (error) {
            console.warn('Ride queue storage unavailable:', error);
        }
        return [...stored, ...await this.memory.all()];
    }

    async remove(id) {
        try {
            if (this.store) await this.store.remove(id);
        } catch (error) {
            console.warn('Ride queue storage unavailable:', error);
        }
        await this.memory.remove(id);
    }
}

// Cloudflare Turnstile, loaded only when a form needs it. Tokens are single use.
class TurnstileWidget {
    constructor() {
        this.siteKey = '';
        this.widgetId = null;
        this.token = null;
        this.waiters = [];
        this.scriptPromise = null;
        this.mountCount = 0;
    }

    loadScript() {
        if (window.turnstile) return Promise.resolve();
        if (!this.scriptPromise) {
            this.scriptPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = TURNSTILE_SCRIPT;
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => {
                    this.scriptPromise = null;
                    reject(new Error('Could not load the bot check'));
                };
                document.head.appendChild(script);
            });
        }
        return this.scriptPromise;
    }

    async mount(container, siteKey) {
        this.unmount();
        const mountId = ++this.mountCount;
        if (!siteKey || !container) return;
        await this.loadScript();
        if (mountId !== this.mountCount) return; // another form took over while the script loaded
        this.siteKey = siteKey;
        this.token = null;
        this.widgetId = window.turnstile.render(container, {
            sitekey: siteKey,
            theme: 'dark',
            size: window.innerWidth < 420 ? 'compact' : 'normal',
            callback: token => {
                this.token = token;
                this.waiters.splice(0).forEach(waiter => waiter.resolve(token));
            },
            'expired-callback': () => { this.token = null; },
            'error-callback': () => { this.token = null; }
        });
    }

    unmount() {
        if (this.widgetId !== null && window.turnstile) {
            try { window.turnstile.remove(this.widgetId); } catch (_) { /* already gone */ }
        }
        this.widgetId = null;
        this.token = null;
        this.waiters.splice(0).forEach(waiter => waiter.reject(new ApiError(0, 'captcha', 'The bot check was interrupted.')));
    }

    // Resolves with a fresh token, or null when no check is configured. Waits while the visitor solves a challenge.
    async consume(timeoutMs = 30000) {
        if (this.widgetId === null) return null;
        let token = this.token;
        if (!token) {
            token = await new Promise((resolve, reject) => {
                const waiter = { resolve, reject };
                this.waiters.push(waiter);
                setTimeout(() => {
                    const index = this.waiters.indexOf(waiter);
                    if (index >= 0) {
                        this.waiters.splice(index, 1);
                        reject(new ApiError(0, 'captcha', 'Please finish the bot check and try again.'));
                    }
                }, timeoutMs);
            });
        }
        this.token = null;
        try { window.turnstile.reset(this.widgetId); } catch (_) { /* widget removed meanwhile */ }
        return token;
    }
}

class AccountManager {
    constructor(options = {}) {
        this.fetchFn = options.fetch || ((...args) => fetch(...args));
        this.queue = options.queue || new RideQueue(AccountManager.defaultStore());
        this.captcha = options.captcha || new TurnstileWidget();
        this.explicitState = options.state || null;
        this.askConsent = options.askConsent || (() => this.showConsentDialog());
        this.listeners = {};
        this.guestRide = null;
        this.lastRideId = null;
        this.flushing = false;
        this.cooldownTimer = null;
        this.consentPromise = null;
        this.config = null;
        this.inertState = { available: false, user: null, profile: null, saveStatus: '', saveMessage: '', ui: { form: {} } };
    }

    static defaultStore() {
        try {
            return globalThis.indexedDB ? new IndexedDbRideStore() : null;
        } catch (_) {
            return null;
        }
    }

    // The Alpine store slice; an inert stand-in keeps the app running if Alpine itself failed to load.
    get state() {
        if (this.explicitState) return this.explicitState;
        const store = window.Alpine && Alpine.store('app');
        return store ? store.account : this.inertState;
    }

    isSignedIn() {
        return Boolean(this.state.available && this.state.user);
    }

    // Events: 'user' (signed-in user, or null after sign-out) and 'rideSaved'.
    on(event, listener) {
        (this.listeners[event] = this.listeners[event] || []).push(listener);
    }

    emit(event, ...args) {
        (this.listeners[event] || []).forEach(listener => listener(...args));
    }

    // ---- API client ----

    async request(method, path, { body, headers } = {}) {
        const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...headers } };
        if (body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        let response;
        try {
            response = await this.fetchFn(path, init);
        } catch (_) {
            throw new ApiError(0, 'network', "Can't reach the server.");
        }
        if (!response.ok) {
            const error = await this.readError(response);
            // A session that ended elsewhere: fall back to the signed-out state.
            if (error.status === 401 && !path.startsWith('/api/auth/') && this.state.user) this.setUser(null);
            throw error;
        }
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    async readError(response) {
        let data = null;
        try { data = JSON.parse(await response.text()); } catch (_) { /* not JSON */ }
        return new ApiError(response.status, data && (data.error || data.code), data && data.message);
    }

    // Saves an authenticated file response (TCX, data export) through a temporary link.
    async download(path, fallbackName) {
        let response;
        try {
            response = await this.fetchFn(path, { credentials: 'same-origin' });
        } catch (_) {
            throw new ApiError(0, 'network', "Can't reach the server.");
        }
        if (!response.ok) throw await this.readError(response);
        const blob = await response.blob();
        const match = /filename="?([^";]+)"?/i.exec(response.headers.get('Content-Disposition') || '');
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = match ? match[1] : fallbackName;
        link.click();
        URL.revokeObjectURL(url);
    }

    async checkHealth() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        try {
            const response = await this.fetchFn('/api/health', { credentials: 'same-origin', signal: controller.signal });
            if (!response.ok) return false;
            // A static host that answers every path with index.html must not count as a backend.
            const data = JSON.parse(await response.text());
            return Boolean(data && data.status === 'ok');
        } catch (_) {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    // ---- Start-up and session state ----

    async init() {
        const state = this.state;
        state.loading = true;
        try {
            state.available = await this.checkHealth();
            if (!state.available) return;
            const dialog = document.getElementById('accountDialog');
            if (dialog) dialog.addEventListener('close', () => this.onDialogClosed());
            window.addEventListener('online', () => this.flushQueue());
            await this.refreshUser();
            this.handleUrlParams();
            await this.flushQueue();
        } finally {
            state.loading = false;
            setTimeout(() => lucide.createIcons(), 0);
        }
    }

    async refreshUser() {
        try {
            this.setUser(await this.request('GET', '/api/me'));
            return Boolean(this.state.user);
        } catch (_) {
            this.setUser(null);
            return false;
        }
    }

    setUser(data) {
        const state = this.state;
        const wasSignedIn = Boolean(state.user);
        state.user = data && data.user ? data.user : null;
        state.profile = data && data.user ? data.profile || null : null;
        if (state.user) this.applyProfileToApp();
        if (wasSignedIn !== Boolean(state.user)) this.emit('user', state.user);
    }

    // The profile wins over the local defaults: rider name feeds localStorage and the name fields, FTP the designer.
    applyProfileToApp() {
        const profile = this.state.profile;
        if (!profile) return;
        if (profile.riderName) {
            try { localStorage.setItem('riderName', profile.riderName); } catch (_) { /* storage blocked */ }
            for (const id of ['quickJoinName', 'hostNameInput', 'joinNameInput']) {
                const input = document.getElementById(id);
                if (input) input.value = profile.riderName;
            }
        }
        const designer = window.workoutDesigner;
        if (Number.isInteger(profile.ftp) && designer && !designer.isRunning) {
            designer.setFTP(profile.ftp);
            for (const id of ['ftpInput', 'sessionFtpInput']) {
                const input = document.getElementById(id);
                if (input) input.value = profile.ftp;
            }
            const sessions = window.app && window.app.sessionManager;
            if (sessions && sessions.sessionId) sessions.updateFTP(profile.ftp);
        }
    }

    // Quietly mirror a change made elsewhere in the app (FTP field, rider name) into the profile.
    async pushProfile(changes) {
        const state = this.state;
        if (!state.available || !state.user || !state.profile) return;
        const body = {};
        if (changes.riderName !== undefined) {
            const name = String(changes.riderName).trim().slice(0, 40);
            if (name && name !== state.profile.riderName) body.riderName = name;
        }
        if (Number.isInteger(changes.ftp) && changes.ftp >= 50 && changes.ftp <= 500 && changes.ftp !== state.profile.ftp) {
            body.ftp = changes.ftp;
        }
        if (Object.keys(body).length === 0) return;
        try {
            state.profile = (await this.request('PUT', '/api/me', { body })).profile;
        } catch (error) {
            console.warn('Profile sync failed:', error);
        }
    }

    // ---- Dialog handling ----

    get dialog() {
        return document.getElementById('accountDialog');
    }

    openDialog(view = null) {
        const state = this.state;
        if (!state.available) return;
        const target = view || (state.user ? 'menu' : 'signin');
        if (target === 'menu') this.fillProfileForm();
        this.setView(target);
        const dialog = this.dialog;
        if (dialog && !dialog.open) dialog.showModal();
    }

    closeDialog() {
        const dialog = this.dialog;
        if (dialog && dialog.open) dialog.close();
    }

    setView(view, notice = '') {
        const ui = this.state.ui;
        ui.view = view;
        ui.error = '';
        ui.notice = notice;
        if (['signin', 'signup', 'forgot'].includes(view)) this.prepareCaptcha(view);
        this.focusWhenShown(view);
    }

    // Alpine reveals the next view a moment after the state change, so retry until the field can take focus.
    focusWhenShown(view, attempts = 10) {
        setTimeout(() => {
            const field = this.dialog && this.dialog.querySelector(`[data-view="${view}"] [data-autofocus]`);
            if (!field || this.state.ui.view !== view) return;
            if (field.offsetParent === null && attempts > 0) {
                this.focusWhenShown(view, attempts - 1);
                return;
            }
            field.focus();
            lucide.createIcons();
        }, 30);
    }

    onDialogClosed() {
        const ui = this.state.ui;
        Object.assign(ui.form, { password: '', code: '', newPassword: '', deletePassword: '', deleteConfirm: false });
        ui.error = '';
        ui.notice = '';
        if (ui.view === 'delete') ui.view = 'menu';
        if (ui.view === 'menu' && !this.state.user) ui.view = 'signin';
    }

    fillProfileForm() {
        const { profile } = this.state;
        const form = this.state.ui.form;
        form.riderName = (profile && profile.riderName) || '';
        form.ftp = profile && profile.ftp ? String(profile.ftp) : '';
        form.hrConsent = Boolean(profile && profile.hrConsentAt);
    }

    async prepareCaptcha(view) {
        const container = this.dialog && this.dialog.querySelector(`[data-view="${view}"] [data-captcha]`);
        if (!container) return;
        try {
            if (!this.config) this.config = await this.request('GET', '/api/config');
            await this.captcha.mount(container, this.config && this.config.turnstileSiteKey);
        } catch (error) {
            // Without a token the server answers with its own bot-check error, which the form then shows.
            console.warn('Bot check unavailable:', error);
        }
    }

    async captchaHeaders() {
        const token = await this.captcha.consume();
        return token ? { 'x-captcha-response': token } : {};
    }

    // Runs a form action with the busy flag and a readable error message.
    async guarded(context, action) {
        const ui = this.state.ui;
        if (ui.busy) return false;
        ui.busy = true;
        ui.error = '';
        try {
            await action();
            return true;
        } catch (error) {
            ui.error = describeError(error, context);
            if (!(error instanceof ApiError)) console.error(error);
            return false;
        } finally {
            ui.busy = false;
        }
    }

    startCooldown(seconds = RESEND_COOLDOWN_SECONDS) {
        this.stopCooldown();
        const ui = this.state.ui;
        ui.cooldown = seconds;
        this.cooldownTimer = setInterval(() => {
            ui.cooldown = Math.max(0, ui.cooldown - 1);
            if (ui.cooldown === 0) this.stopCooldown();
        }, 1000);
    }

    stopCooldown() {
        if (this.cooldownTimer !== null) clearInterval(this.cooldownTimer);
        this.cooldownTimer = null;
    }

    // Reads ?verified=1 and ?reset=1&token=… from the e-mail links, then removes them from the address bar.
    handleUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const verified = params.get('verified') === '1';
        const reset = params.get('reset') === '1';
        const token = params.get('token');
        const failed = params.get('error');
        if (!verified && !reset && !failed) return;
        const ui = this.state.ui;
        if (reset && token && !failed) {
            ui.resetToken = token;
            this.openDialog('reset');
        } else if (reset) {
            this.openDialog('forgot');
            ui.error = 'This reset link is invalid or has expired. Request a new one.';
        } else if (failed) {
            this.openDialog('signin');
            ui.error = 'That link is invalid or has expired. Please try again.';
        } else if (this.state.user) {
            this.openDialog('menu');
            ui.notice = 'Your email is verified. You are signed in.';
        } else {
            this.openDialog('signin');
            ui.notice = 'Your email is verified. Sign in to continue.';
        }
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }

    // ---- Sign-in, sign-up, password reset ----

    signIn() {
        const form = this.state.ui.form;
        const email = form.email.trim();
        return this.guarded('signin', async () => {
            let result;
            try {
                result = await this.request('POST', '/api/auth/sign-in/email', {
                    body: { email, password: form.password, rememberMe: true },
                    headers: await this.captchaHeaders()
                });
            } catch (error) {
                if (error instanceof ApiError && String(error.code).toUpperCase() === 'EMAIL_NOT_VERIFIED') {
                    this.state.ui.pendingEmail = email;
                    this.setView('verify', "Your email isn't verified yet. Check your inbox, or send the link again.");
                    return;
                }
                throw error;
            }
            form.password = '';
            if (result && result.twoFactorRedirect) {
                this.state.ui.pendingEmail = email;
                form.code = '';
                this.setView('code');
                this.startCooldown();
                if (SEND_CODE_AFTER_SIGN_IN) await this.request('POST', '/api/auth/two-factor/send-otp', { body: {} });
            } else {
                await this.finishSignIn();
            }
        });
    }

    resendCode() {
        if (this.state.ui.cooldown > 0) return Promise.resolve(false);
        return this.guarded('code', async () => {
            await this.request('POST', '/api/auth/two-factor/send-otp', { body: {} });
            this.startCooldown();
            this.state.ui.notice = 'A new code is on its way.';
        });
    }

    verifyCode() {
        const form = this.state.ui.form;
        const code = form.code.replace(/\s+/g, '');
        if (!/^\d{6}$/.test(code)) {
            this.state.ui.error = 'Enter the 6-digit code from your email.';
            return Promise.resolve(false);
        }
        return this.guarded('code', async () => {
            await this.request('POST', '/api/auth/two-factor/verify-otp', { body: { code, trustDevice: Boolean(form.trustDevice) } });
            form.code = '';
            await this.finishSignIn();
        });
    }

    async finishSignIn() {
        if (!await this.refreshUser()) {
            throw new ApiError(500, 'session', 'Signed in, but your session could not be loaded. Please reload the page.');
        }
        this.stopCooldown();
        this.closeDialog();
        if (window.app) window.app.log(`Signed in as ${this.state.user.email}`, 'success');
        if (this.guestRide) await this.saveRide(this.guestRide);
        await this.flushQueue();
    }

    signUp() {
        const form = this.state.ui.form;
        const name = form.name.trim();
        const email = form.email.trim();
        if (!name || name.length > 40) {
            this.state.ui.error = 'Enter a name of up to 40 characters.';
            return Promise.resolve(false);
        }
        if (form.password.length < PASSWORD_MIN || form.password.length > PASSWORD_MAX) {
            this.state.ui.error = `Use a password of ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`;
            return Promise.resolve(false);
        }
        return this.guarded('signup', async () => {
            await this.request('POST', '/api/auth/sign-up/email', {
                body: { email, password: form.password, name, callbackURL: '/?verified=1' },
                headers: await this.captchaHeaders()
            });
            form.password = '';
            this.state.ui.pendingEmail = email;
            this.setView('verify');
            this.startCooldown();
        });
    }

    resendVerification() {
        if (this.state.ui.cooldown > 0) return Promise.resolve(false);
        return this.guarded('verify', async () => {
            await this.request('POST', '/api/auth/send-verification-email', {
                body: { email: this.state.ui.pendingEmail, callbackURL: '/?verified=1' }
            });
            this.startCooldown();
            this.state.ui.notice = 'Verification email sent. Check your inbox.';
        });
    }

    requestReset() {
        const email = this.state.ui.form.email.trim();
        return this.guarded('forgot', async () => {
            await this.request('POST', '/api/auth/request-password-reset', {
                body: { email, redirectTo: '/?reset=1' },
                headers: await this.captchaHeaders()
            });
            this.state.ui.notice = 'If that address has an account, a reset link is on its way.';
        });
    }

    resetPassword() {
        const ui = this.state.ui;
        if (ui.form.newPassword.length < PASSWORD_MIN || ui.form.newPassword.length > PASSWORD_MAX) {
            ui.error = `Use a password of ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`;
            return Promise.resolve(false);
        }
        return this.guarded('reset', async () => {
            await this.request('POST', '/api/auth/reset-password', { body: { newPassword: ui.form.newPassword, token: ui.resetToken } });
            ui.form.newPassword = '';
            ui.resetToken = '';
            this.setView('signin', 'Password changed. Sign in with your new password.');
        });
    }

    // ---- Signed-in menu ----

    signOut() {
        return this.guarded('signout', async () => {
            try {
                await this.request('POST', '/api/auth/sign-out', { body: {} });
            } catch (error) {
                if (!(error instanceof ApiError) || error.status !== 401) throw error;
            }
            this.leave();
        });
    }

    signOutEverywhere() {
        return this.guarded('signout', async () => {
            await this.request('POST', '/api/auth/revoke-sessions', { body: {} });
            this.leave();
        });
    }

    leave() {
        this.guestRide = null;
        this.setUser(null);
        this.state.saveStatus = '';
        this.state.saveMessage = '';
        this.closeDialog();
    }

    async updateProfile(body) {
        const data = await this.request('PUT', '/api/me', { body });
        this.state.profile = data.profile;
        if (data.user) this.state.user = data.user;
        this.applyProfileToApp();
    }

    saveProfile() {
        const { form } = this.state.ui;
        const { profile } = this.state;
        const body = {};
        const name = form.riderName.trim();
        if (name && name !== (profile && profile.riderName)) {
            if (name.length > 40) {
                this.state.ui.error = 'Rider name can have up to 40 characters.';
                return Promise.resolve(false);
            }
            body.riderName = name;
        }
        const ftp = Number(form.ftp);
        if (String(form.ftp).trim() !== '') {
            if (!Number.isInteger(ftp) || ftp < 50 || ftp > 500) {
                this.state.ui.error = 'FTP must be a whole number between 50 and 500.';
                return Promise.resolve(false);
            }
            if (ftp !== (profile && profile.ftp)) body.ftp = ftp;
        }
        if (Boolean(form.hrConsent) !== Boolean(profile && profile.hrConsentAt)) body.hrConsent = Boolean(form.hrConsent);
        if (Object.keys(body).length === 0) {
            this.state.ui.notice = 'Nothing to save.';
            return Promise.resolve(true);
        }
        return this.guarded('profile', async () => {
            await this.updateProfile(body);
            this.fillProfileForm();
            this.state.ui.notice = 'Profile saved.';
        });
    }

    exportData() {
        return this.guarded('export', () => this.download('/api/me/export', 'cadence-export.json'));
    }

    deleteAccount() {
        const { form } = this.state.ui;
        if (!form.deletePassword || !form.deleteConfirm) {
            this.state.ui.error = 'Enter your password and tick the box to confirm.';
            return Promise.resolve(false);
        }
        const userId = this.state.user && this.state.user.id;
        return this.guarded('delete', async () => {
            await this.request('DELETE', '/api/me', { body: { password: form.deletePassword } });
            for (const entry of await this.queue.all()) {
                if (entry.userId === userId) await this.queue.remove(entry.id);
            }
            this.leave();
            if (window.app) window.app.log('Your account and all its rides were deleted', 'info');
        });
    }

    // ---- Saving rides ----

    setSaveStatus(status, message = '') {
        const messages = {
            saving: 'Saving to your history…',
            saved: 'Saved to your history',
            queued: 'Saved offline, will sync',
            login: 'Sign in to save this ride'
        };
        this.state.saveStatus = status;
        this.state.saveMessage = message || messages[status] || '';
    }

    // Entry point after a ride: upload when signed in, otherwise hold it for the next sign-in.
    async saveRide(payload) {
        const state = this.state;
        this.setSaveStatus('');
        if (!payload || !state.available) return 'unavailable';
        this.lastRideId = payload.id;
        if (!state.user) {
            this.guestRide = payload;
            this.setSaveStatus('login');
            return 'login';
        }
        this.guestRide = null;
        return this.uploadRide(payload);
    }

    async uploadRide(original) {
        let payload = original;
        const userId = this.state.user ? this.state.user.id : null; // a 401 clears the user before we can queue
        this.setSaveStatus('saving');
        let result = await this.tryUpload(payload);
        if (result.status === 'consent') {
            if (await this.askConsent()) {
                try {
                    await this.updateProfile({ hrConsent: true });
                    result = await this.tryUpload(payload);
                } catch (error) {
                    result = { status: isRetryableStatus(error.status) ? 'retry' : 'rejected', error };
                }
            } else {
                payload = withoutHeartRate(payload);
                result = await this.tryUpload(payload);
            }
        }
        return this.finishUpload(payload, result, userId);
    }

    // One POST /api/rides, classified: saved, consent, login, retry (try again later) or rejected (final).
    async tryUpload(payload) {
        try {
            await this.request('POST', '/api/rides', { body: payload });
            return { status: 'saved' };
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            if (error.status === 428) return { status: 'consent', error };
            if (error.status === 401) return { status: 'login', error };
            if (isRetryableStatus(error.status)) return { status: 'retry', error };
            return { status: 'rejected', error };
        }
    }

    async finishUpload(payload, result, userId) {
        if (result.status === 'saved') {
            this.setSaveStatus('saved');
            this.emit('rideSaved');
            return 'saved';
        }
        if (result.status === 'retry' || result.status === 'login' || result.status === 'consent') {
            await this.enqueue(payload, userId);
            if (result.status === 'login') this.setSaveStatus('login', 'Your session ended. Sign in to save this ride.');
            else if (result.status === 'consent') this.setSaveStatus('error', 'Could not save this ride without heart-rate consent.');
            else this.setSaveStatus('queued');
            return result.status === 'retry' ? 'queued' : result.status;
        }
        this.setSaveStatus('error', `Could not save this ride: ${describeError(result.error)}`);
        return 'error';
    }

    async enqueue(payload, userId) {
        await this.queue.put({ id: payload.id, userId, payload, queuedAt: Date.now() });
    }

    // Retries queued rides of the signed-in user. Final rejections (4xx other than 401/428) are dropped.
    async flushQueue() {
        const user = this.state.user;
        if (this.flushing || !user) return;
        this.flushing = true;
        let saved = 0;
        try {
            const entries = (await this.queue.all())
                .filter(entry => entry.userId === user.id)
                .sort((a, b) => a.queuedAt - b.queuedAt);
            for (const entry of entries) {
                const result = await this.tryUpload(entry.payload);
                if (result.status === 'saved' || result.status === 'rejected') {
                    await this.queue.remove(entry.id);
                    if (result.status === 'saved') {
                        saved++;
                        if (entry.id === this.lastRideId) this.setSaveStatus('saved');
                    }
                } else if (result.status === 'retry' || result.status === 'login') {
                    break; // still offline or signed out; keep the rest for later
                }
                // 'consent': keep the entry; it uploads once heart-rate consent has been given.
            }
        } finally {
            this.flushing = false;
        }
        if (saved > 0) this.emit('rideSaved');
    }

    showConsentDialog() {
        const dialog = document.getElementById('hrConsentDialog');
        if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(false);
        if (!this.consentPromise) {
            this.consentPromise = new Promise(resolve => {
                dialog.returnValue = '';
                dialog.addEventListener('close', () => {
                    this.consentPromise = null;
                    resolve(dialog.returnValue === 'accept'); // Escape counts as "don't store"
                }, { once: true });
                dialog.showModal();
            });
        }
        return this.consentPromise;
    }
}

// --- bootstrap (not part of the unit-tested class code) ---
window.accountManager = new AccountManager();
(function startAccountManager() {
    const start = () => window.accountManager.init();
    if (window.Alpine && Alpine.store && Alpine.store('app')) start();
    else document.addEventListener('alpine:initialized', start, { once: true });
})();
