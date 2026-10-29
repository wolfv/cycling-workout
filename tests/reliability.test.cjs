const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function harness() {
    let now = 100000;
    let nextTimer = 0;
    const timers = new Map();
    const storage = new Map();
    const elements = new Map();
    const element = () => ({
        style: {}, dataset: {}, classList: { add() {}, remove() {} },
        children: new Map(), events: {}, innerHTML: '', textContent: '',
        querySelector(selector) {
            if (!this.children.has(selector)) this.children.set(selector, element());
            return this.children.get(selector);
        },
        addEventListener(type, callback) { this.events[type] = callback; },
        setAttribute(name, value) { this[name] = value; },
        showModal() { this.open = true; }, close() { this.open = false; },
        appendChild() {}, replaceChildren() {}
    });
    const setTimer = (callback, delay, repeat = false) => {
        timers.set(++nextTimer, { callback, delay, repeat });
        return nextTimer;
    };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, AbortController,
        Date: class extends Date { static now() { return now; } },
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
            createElement: element
        },
        alert() {}, confirm: () => true,
        WorkoutProgressVisualizer: class {
            setWorkout() {} start() {} clear() {} updateProgress() {} setIntensityScale() {}
        }
    });
    context.window = context;
    for (const [file, name] of [
        ['workout-designer.js', 'WorkoutDesigner'], ['ftms.js', 'FTMSController'],
        ['session-p2p.js', 'P2PSessionManager'], ['app.js', 'App']
    ]) {
        const source = readFileSync(join(__dirname, '..', file), 'utf8').replace('const app = new App();', '');
        vm.runInContext(`${source}\nglobalThis.${name} = ${name};`, context);
    }
    return {
        context, timers, storage, elements,
        setTime(value) { now = value; },
        async fire(id) {
            const timer = timers.get(id);
            assert.ok(timer, `timer ${id} exists`);
            if (!timer.repeat) timers.delete(id);
            await timer.callback();
        }
    };
}

const ramp = { name: 'Ramp', type: 'warmup', powerType: 'ramp', percentageLow: 0, percentageHigh: 100, duration: 60 };
const steady = { name: 'Steady', type: 'tempo', percentage: 80, duration: 60 };
function designer(h) {
    const powers = [];
    const d = new h.context.WorkoutDesigner({
        log() {}, isConnected: () => true,
        setTargetPower: power => { powers.push(power); return Promise.resolve(true); }
    });
    d.render = () => {};
    h.context.workoutDesigner = d;
    return { d, powers };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function bluetooth(h, acknowledge = true) {
    const controller = new h.context.FTMSController();
    const writes = [];
    const characteristic = new EventTarget();
    characteristic.startNotifications = async () => {};
    characteristic.ack = (opcode, result = 1) => {
        characteristic.value = new DataView(Uint8Array.from([0x80, opcode, result]).buffer);
        characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    };
    characteristic.writeValue = data => {
        writes.push([...data]);
        if (acknowledge) characteristic.ack(data[0]);
        return Promise.resolve();
    };
    const device = new EventTarget();
    device.name = 'Test trainer';
    const server = { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) };
    device.gatt = {
        connected: false,
        async connect() { this.connected = true; return server; },
        disconnect() {
            if (!this.connected) return;
            this.connected = false;
            device.dispatchEvent(new Event('gattserverdisconnected'));
        }
    };
    controller.subscribeToMetrics = async () => {};
    return { controller, device, characteristic, writes };
}

test('ramp settings survive saving, loading, JSON and direct import', () => {
    const h = harness();
    const { d } = designer(h);
    const sample = JSON.parse(readFileSync(join(__dirname, '../sample-workouts/ramp-workout.json')));
    d.importWorkoutData(sample);
    const expected = JSON.stringify(d.exportWorkoutData().intervals);
    d.loadWorkout(sample.name);
    assert.equal(JSON.stringify(d.exportWorkoutData().intervals), expected);
    d.intervals = [ramp];
    d.saveWorkout('__proto__');
    d.loadWorkout('__proto__');
    assert.equal(d.intervals[0].percentageLow, 0);
    assert.equal(d.intervals[0].percentageHigh, 100);
});

test('invalid imported intervals are rejected without replacing the workout', () => {
    const h = harness();
    const { d } = designer(h);
    d.intervals = [steady];
    for (const bad of [null, { ...steady, duration: -1 }, { ...steady, duration: Infinity },
        { ...steady, percentage: NaN }, { ...steady, percentage: -10 }, { ...steady, powerType: 'oops' }]) {
        assert.throws(() => d.importWorkoutData({ intervals: [bad] }));
        assert.equal(d.intervals[0], steady);
    }
    assert.throws(() => d.importWorkoutData({ intervals: [ramp], ftp: -200 }));
    assert.equal(d.intervals[0], steady);
});

test('zero targets and ramp endpoints are preserved; estimates use ramp average', () => {
    const h = harness();
    const { d } = designer(h);
    assert.equal(d.getIntervalPower({ ...steady, percentage: 0 }), 0);
    assert.equal(d.getIntervalPower(ramp, -10), 0);
    assert.equal(d.getIntervalPower(ramp, 30), 100);
    assert.equal(d.getIntervalPower(ramp, 90), 200);
    d.intervals = [ramp];
    d.updateWorkoutInfo();
    assert.equal(h.elements.get('avgPower').textContent, 100);
});

test('late joins use the current ramp power and only the remaining interval time', async () => {
    const h = harness();
    const { d, powers } = designer(h);
    d.intervals = [ramp, steady];
    await d.startWorkout(70000);
    assert.equal(d.currentIntervalIndex, 0);
    assert.equal(powers.at(-1), 100);
    assert.equal(h.timers.get(d.workoutTimer).delay, 30000);
    d.setIntensityScale(1.2);
    assert.equal(powers.at(-1), 120);
    assert.match(h.elements.get('currentIntervalTarget').textContent, /^120W/);
    assert.equal(h.elements.get('currentIntervalCountdown').style.display, 'none');
    h.setTime(125000);
    d.updateProgress();
    assert.equal(h.elements.get('countdownSeconds').textContent, '5s');
});

test('delayed callbacks skip expired intervals and stop at the original finish', async () => {
    const h = harness();
    const { d, powers } = designer(h);
    d.intervals = [steady, steady, ramp];
    await d.startWorkout();
    h.setTime(235000);
    await h.fire(d.workoutTimer);
    assert.equal(d.currentIntervalIndex, 2);
    assert.equal(powers.at(-1), 50);
    assert.equal(h.timers.get(d.workoutTimer).delay, 45000);
    h.setTime(280000);
    await h.fire(d.workoutTimer);
    assert.equal(d.isRunning, false);
    assert.equal(powers.at(-1), 0);
    assert.equal(h.timers.size, 0);
});

test('duplicate starts, expired workouts and stopping during a Bluetooth write leave no extra timers', async () => {
    const h = harness();
    const { d } = designer(h);
    d.intervals = [steady];
    await d.startWorkout(0);
    assert.equal(d.isRunning, false);
    assert.equal(h.timers.size, 0);
    let resolveWrite;
    d.ftms.setTargetPower = () => new Promise(resolve => { resolveWrite = resolve; });
    await d.startWorkout();
    const timer = d.workoutTimer;
    await d.startWorkout();
    assert.equal(d.workoutTimer, timer);
    d.stopWorkout();
    resolveWrite(true);
    await flush();
    assert.equal(h.timers.size, 0);
});

test('future starts send no power before the shared timestamp', async () => {
    const h = harness();
    const { d, powers } = designer(h);
    d.intervals = [steady];
    await d.startWorkout(110000);
    d.applyCurrentIntervalTarget();
    assert.equal(powers.length, 0);
    h.setTime(110000);
    await h.fire(d.workoutTimer);
    assert.equal(powers.at(-1), 160);
});

test('active workouts cannot be replaced or edited during reconnects', async () => {
    const h = harness();
    const { d } = designer(h);
    d.intervals = [steady];
    await d.startWorkout();
    d.clearWorkout();
    d.removeInterval(steady.id);
    d.addInterval('warmup');
    assert.throws(() => d.importWorkoutData({ intervals: [ramp] }), /Stop the workout/);
    assert.equal(d.intervals.length, 1);
});

test('workout names are text, not HTML or inline JavaScript', () => {
    const h = harness();
    const { d } = designer(h);
    const name = `Rider's <img src=x onerror=alert(1)>`;
    const interval = d.createIntervalElement({ ...steady, name, id: 42 }, 0, 1);
    assert.equal(interval.querySelector('.interval-info').textContent, name);
    assert.ok(!interval.innerHTML.includes(name));
    const app = Object.create(h.context.App.prototype);
    const card = app.createWorkoutCard(name, { intervals: [steady], description: name });
    assert.ok(!card.innerHTML.includes(name));
    assert.ok(!card.innerHTML.includes('onclick='));
    assert.equal(card.querySelector('.workout-card-title').textContent, name);
    let selected;
    app.loadWorkoutFromLibrary = value => { selected = value; };
    card.events.click();
    assert.equal(selected, name);
});

test('Bluetooth disconnect reconnects, reclaims control, and explicit disconnect cancels retries', async () => {
    const h = harness();
    const { controller, device, writes } = bluetooth(h);
    const states = [];
    controller.onConnectionChange = connected => states.push(connected);
    assert.equal(await controller.connectToDevice(device), true);
    assert.equal(controller.isConnected(), true);
    device.gatt.disconnect();
    assert.equal(controller.isConnected(), false);
    assert.ok(controller.reconnectTimer);
    await h.fire(controller.reconnectTimer);
    assert.deepEqual(states, [true, false, true]);
    assert.equal(writes.filter(data => data[0] === 0).length, 2);
    device.gatt.disconnect();
    controller.disconnect();
    assert.equal(h.timers.size, 0);
});

test('FTMS serializes acknowledged commands and drops stale queued power targets', async () => {
    const h = harness();
    const { controller, device, characteristic, writes } = bluetooth(h);
    await controller.connectToDevice(device);
    characteristic.writeValue = data => { writes.push([...data]); return Promise.resolve(); };
    const first = controller.setTargetPower(100);
    await flush();
    const stale = controller.setTargetPower(200);
    const stop = controller.setTargetPower(0);
    assert.equal(writes.length, 2);
    characteristic.ack(5);
    assert.equal(await first, true);
    assert.equal(await stale, false);
    await flush();
    assert.deepEqual(writes.at(-1), [5, 0, 0]);
    characteristic.ack(5);
    assert.equal(await stop, true);
    assert.equal(await controller.setTargetPower(NaN), false);
});

test('FTMS timeout disconnects instead of accepting a late response for another command', async () => {
    const h = harness();
    const { controller, device, characteristic } = bluetooth(h);
    await controller.connectToDevice(device);
    characteristic.writeValue = () => new Promise(() => {});
    const result = controller.setTargetPower(200);
    await flush();
    const timeout = [...h.timers.entries()].find(([, timer]) => timer.delay === 5000)[0];
    await h.fire(timeout);
    assert.equal(await result, false);
    assert.equal(device.gatt.connected, false);
    assert.ok(controller.reconnectTimer);
});

test('round-trip clock sync compensates latency before delivering a session start', () => {
    const h = harness();
    const session = new h.context.P2PSessionManager();
    const sent = [];
    session.sendToPeer = (peerId, message) => sent.push(message);
    let start;
    session.onSessionStart = time => { start = time; };
    session.handleP2PMessage('host', { type: 'start-countdown', startTime: 110000 });
    assert.equal(start, undefined);
    h.setTime(100200);
    // Host is 500 ms behind us, with 100 ms each-way network latency.
    session.handleP2PMessage('host', { type: 'clock-response', sentAt: 100000, hostTime: 99600 });
    assert.equal(session.clockOffset, 500);
    assert.equal(start, 110500);
    assert.equal(h.timers.size, 0);
});

test('legacy clock fallback works and end-workout cancels pending start', async () => {
    const h = harness();
    const session = new h.context.P2PSessionManager();
    session.sendToPeer = () => {};
    const starts = [];
    session.onSessionStart = time => starts.push(time);
    session.handleP2PMessage('host', { type: 'clock-sync', hostTime: 99000 });
    session.handleP2PMessage('host', { type: 'start-countdown', startTime: 110000 });
    await h.fire(session.startSyncTimer);
    assert.deepEqual(starts, [111000]);
    session.handleP2PMessage('host', { type: 'start-countdown', startTime: 120000 });
    session.handleP2PMessage('host', { type: 'end-workout' });
    assert.equal(h.timers.size, 0);
});

test('relayed metrics retain the original rider identity', () => {
    const h = harness();
    const session = new h.context.P2PSessionManager();
    session.isHost = true;
    session.participants.set('rider', {});
    let relayed;
    session.broadcast = message => { relayed = message; };
    session.handleP2PMessage('rider', { type: 'metrics', power: 240, peerId: 'spoofed' });
    assert.equal(relayed.peerId, 'rider');
    session.isHost = false;
    session.participants.set('host', { power: 100 });
    session.handleP2PMessage('host', relayed);
    assert.equal(session.participants.get('host').power, 100);
    assert.equal(session.participants.get('rider').power, 240);
});

test('Bluetooth retry backoff stops after five failures', async () => {
    const h = harness();
    const { controller, device } = bluetooth(h);
    await controller.connectToDevice(device);
    device.gatt.disconnect();
    device.gatt.connect = async () => { throw new Error('Out of range'); };
    const delays = [];
    while (controller.reconnectTimer) {
        delays.push(h.timers.get(controller.reconnectTimer).delay);
        await h.fire(controller.reconnectTimer);
    }
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 10000]);
    assert.equal(controller.isConnected(), false);
});

test('disconnecting during connection setup cannot resurrect the connection', async () => {
    const h = harness();
    const { controller, device } = bluetooth(h);
    let finishConnect;
    device.gatt.connect = () => new Promise(resolve => { finishConnect = resolve; });
    const connecting = controller.connectToDevice(device);
    controller.disconnect();
    device.gatt.connected = true;
    finishConnect({});
    assert.equal(await connecting, false);
    assert.equal(device.gatt.connected, false);
    assert.equal(h.timers.size, 0);
});

test('an FTMS acknowledgement alone cannot overlap unfinished GATT writes', async () => {
    const h = harness();
    const { controller, device, characteristic } = bluetooth(h);
    await controller.connectToDevice(device);
    let finishWrite;
    let writes = 0;
    characteristic.writeValue = data => {
        writes++;
        characteristic.ack(data[0]);
        return new Promise(resolve => { finishWrite = resolve; });
    };
    const first = controller.setTargetPower(100);
    await flush();
    const second = controller.setTargetPower(200);
    await flush();
    assert.equal(writes, 1);
    finishWrite();
    assert.equal(await first, true);
    await flush();
    assert.equal(writes, 2);
    finishWrite();
    assert.equal(await second, true);
});

function mockPeers(h) {
    h.context.SimplePeer = class {
        constructor() { this.events = {}; this.connected = false; this.messages = []; }
        on(type, callback) { this.events[type] = callback; }
        send(message) { this.messages.push(JSON.parse(message)); }
        destroy() { this.events.close?.(); }
    };
}

test('late join sends the saved workout before its original start time, only for the same session', () => {
    const h = harness();
    mockPeers(h);
    const session = new h.context.P2PSessionManager();
    session.isHost = true;
    session.sessionId = 'ride';
    h.storage.set('workout_start_info', JSON.stringify({
        sessionId: 'ride', startTime: 70000, workout: { intervals: [steady] }
    }));
    session.createPeerConnection('rider', true);
    const peer = session.peers.get('rider');
    peer.connected = true;
    peer.events.connect();
    assert.deepEqual(peer.messages.map(message => message.type), ['clock-sync', 'workout', 'start-countdown']);
    assert.equal(peer.messages.at(-1).startTime, 70000);
    session.sessionId = 'another-ride';
    peer.messages = [];
    peer.events.connect();
    assert.deepEqual(peer.messages.map(message => message.type), ['clock-sync']);
});

test('host repairs a closed peer connection, but leaving cancels pending repairs', async () => {
    const h = harness();
    mockPeers(h);
    const session = new h.context.P2PSessionManager();
    session.isHost = true;
    session.sessionId = 'ride';
    session.participants.set('rider', {});
    session.createPeerConnection('rider', true);
    const first = session.peers.get('rider');
    first.destroy();
    await h.fire(session.peerRetryTimers.get('rider'));
    const second = session.peers.get('rider');
    assert.notEqual(first, second);
    second.destroy();
    session.disconnect();
    assert.equal(h.timers.size, 0);
});

test('signaling reconnects after loss and explicit leave does not reconnect', async () => {
    const h = harness();
    const sockets = [];
    h.context.WebSocket = class {
        static OPEN = 1;
        constructor() { this.readyState = 1; sockets.push(this); }
        send() {}
        close() { this.readyState = 3; this.onclose?.(); }
        identify(id) { this.onmessage({ data: JSON.stringify({ type: 'id', id, isHost: true }) }); }
    };
    const session = new h.context.P2PSessionManager();
    session.sessionId = 'ride';
    const initial = session.connectToSignaling();
    sockets[0].identify('first');
    await initial;
    sockets[0].close();
    assert.ok(session.reconnectTimer);
    const reconnect = h.fire(session.reconnectTimer);
    sockets[1].identify('second');
    await reconnect;
    assert.equal(session.myPeerId, 'second');
    assert.equal(session.participants.has('first'), false);
    session.disconnect();
    assert.equal(h.timers.size, 0);
});

test('charts support zero power and descending ramps without invalid coordinates', () => {
    const h = harness();
    for (const [file, name] of [['workout-preview.js', 'WorkoutPreview'], ['workout-progress.js', 'WorkoutProgressVisualizer'], ['racetrack.js', 'RaceTrackVisualizer']]) {
        vm.runInContext(`${readFileSync(join(__dirname, '..', file), 'utf8')}\nglobalThis.${name} = ${name};`, h.context);
    }
    const coordinates = [];
    const ctx = new Proxy({}, { get(target, key) {
        if (key in target) return target[key];
        return (...args) => {
            for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg));
            if (key === 'moveTo' || key === 'lineTo') coordinates.push(args);
        };
    } });
    h.elements.set('preview', { width: 400, height: 100, getContext: () => ctx });
    const descending = { ...ramp, percentageLow: 100, percentageHigh: 0 };
    for (const intervals of [[{ ...steady, percentage: 0 }], [descending]]) {
        h.context.WorkoutPreview.drawPreview('preview', intervals);
        const progress = Object.create(h.context.WorkoutProgressVisualizer.prototype);
        Object.assign(progress, { ctx, width: 400, height: 100, ftp: 200, intensityScale: 1, intervals, colorMap: {}, currentIntervalIndex: -1 });
        progress.draw();
        const race = Object.create(h.context.RaceTrackVisualizer.prototype);
        Object.assign(race, { ctx, intervals, ftp: 200, totalDuration: 60 });
        race.drawIntervals(40, 100, 400);
    }
    assert.ok(coordinates.every(([, y]) => y >= 0));
});

async function cadenceSensors(h) {
    const controller = new h.context.FTMSController();
    const characteristics = new Map();
    controller.notificationController = new AbortController();
    controller.server = { getPrimaryService: async () => ({ getCharacteristic: async id => {
        const characteristic = new EventTarget();
        characteristic.startNotifications = async () => {};
        characteristic.notify = bytes => {
            // Real DataViews may point into a larger notification buffer.
            const buffer = Uint8Array.from([255, 255, ...bytes, 255]);
            characteristic.value = new DataView(buffer.buffer, 2, bytes.length);
            characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
        };
        characteristics.set(id, characteristic);
        return characteristic;
    } }) };
    await controller.subscribeToMetrics();
    return { controller, characteristics };
}

test('FTMS half-RPM units decode correctly, including DataView offsets and heart rate flags', async () => {
    const h = harness();
    const { controller, characteristics } = await cadenceSensors(h);
    const ftms = characteristics.get(0x2ad2);
    ftms.notify([0x45, 0x03, 180, 0, 200, 0, 0, 0, 0, 0, 0, 155]);
    assert.equal(controller.metrics.cadence, 90);
    assert.equal(controller.metrics.power, 200);
    assert.equal(controller.metrics.hr, 155);
    assert.equal(controller.metrics.cadenceSource, 'ftms');
    // Average speed and instantaneous speed precede cadence when present.
    ftms.notify([0x06, 0, 0, 0, 0, 0, 181, 0]);
    assert.equal(controller.metrics.cadence, 91);
    ftms.notify([0x45, 0, 200, 0]); // Missing power: do not accept partial data.
    assert.equal(controller.metrics.cadence, 91);
    ftms.notify([0x05, 0, 255, 255]); // Reserved / implausible cadence.
    assert.equal(controller.metrics.cadence, 91);
});

test('concurrent cadence services cannot alternate the display between 1x and 2x', async () => {
    const h = harness();
    const { controller, characteristics } = await cadenceSensors(h);
    const ftms = characteristics.get(0x2ad2);
    const csc = characteristics.get(0x2a5b);
    const power = characteristics.get(0x2a63);
    ftms.notify([5, 0, 180, 0]);
    csc.notify([2, 0, 0, 0, 0]);
    power.notify([0x20, 0, 200, 0, 0, 0, 0, 0]);
    csc.notify([2, 3, 0, 0, 4]); // 180 RPM from a conflicting source.
    power.notify([0x20, 0, 200, 0, 3, 0, 0, 4]);
    assert.equal(controller.metrics.cadence, 90);
    assert.equal(controller.cadenceSource, 'ftms');
    h.setTime(103001);
    csc.notify([2, 5, 0, 0, 8]);
    assert.equal(controller.metrics.cadence, 120);
    assert.equal(controller.cadenceSource, 'csc');
    ftms.notify([5, 0, 178, 0]);
    assert.equal(controller.metrics.cadence, 89);
    assert.equal(controller.cadenceSource, 'ftms');
});

test('crank cadence handles rollover, duplicate packets, stopping and missing notifications', async () => {
    const h = harness();
    const { controller, characteristics } = await cadenceSensors(h);
    const csc = characteristics.get(0x2a5b);
    csc.notify([2, 255, 255, 0, 254]);
    csc.notify([2, 0, 0, 0, 2]);
    assert.equal(controller.metrics.cadence, 60);
    h.setTime(101000);
    csc.notify([2, 0, 0, 0, 2]);
    assert.equal(controller.metrics.cadence, 60);
    h.setTime(103100);
    csc.notify([2, 0, 0, 0, 2]);
    assert.equal(controller.metrics.cadence, 0);
    csc.notify([2, 1, 0, 0, 6]);
    assert.equal(controller.metrics.cadence, 60);
    await h.fire(controller.cadenceTimer);
    assert.equal(controller.metrics.cadence, 0);
    assert.equal(controller.metrics.cadenceSource, null);
    controller.resetCadence();
    assert.equal(h.timers.size, 0);
    assert.equal(Object.keys(controller.crankSamples).length, 0);
});

test('Cycling Power cadence uses crank units after optional wheel, torque and balance fields', async () => {
    const h = harness();
    const { controller, characteristics } = await cadenceSensors(h);
    const power = characteristics.get(0x2a63);
    const prefix = [0x35, 0, 200, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0];
    power.notify([...prefix, 10, 0, 0, 0]);
    power.notify([...prefix, 13, 0, 0, 8]);
    assert.equal(controller.metrics.cadence, 90);
    assert.equal(controller.cadenceSource, 'power');
    controller.updateCadence('csc', 88);
    power.notify([...prefix, 16, 0, 0, 16]);
    assert.equal(controller.metrics.cadence, 88);
});

test('interval dialog saves relative, absolute and ramp intervals without dropping zero targets', () => {
    const h = harness();
    const { d } = designer(h);
    d.intervals = [{ ...steady, id: 123 }];
    d.showEditDialog(d.intervals[0]);
    assert.equal(h.elements.get('intervalDialog').open, true);
    h.elements.get('intervalPowerType').value = 'ramp';
    h.elements.get('intervalPower').value = '0';
    h.elements.get('intervalRampEnd').value = '120';
    h.elements.get('intervalDuration').value = '120';
    d.saveIntervalEdit({ preventDefault() {} });
    assert.equal(d.intervals[0].percentageLow, 0);
    assert.equal(d.intervals[0].percentageHigh, 120);
    assert.equal(d.intervals[0].id, 123);
    assert.equal(h.elements.get('intervalDialog').open, false);
    d.showEditDialog(d.intervals[0]);
    h.elements.get('intervalPowerType').value = 'absolute';
    h.elements.get('intervalPower').value = '180';
    d.saveIntervalEdit({ preventDefault() {} });
    assert.equal(d.intervals[0].power, 180);
    assert.equal(d.intervals[0].percentageLow, undefined);
    d.showEditDialog(d.intervals[0]);
    h.elements.get('intervalDuration').value = '-10';
    d.saveIntervalEdit({ preventDefault() {} });
    assert.equal(d.intervals[0].duration, 120);
    assert.ok(h.elements.get('intervalEditError').textContent);
});

test('dragging intervals can move them both earlier and later', () => {
    const h = harness();
    const { d } = designer(h);
    const first = { ...steady, id: 1 };
    const second = { ...ramp, id: 2 };
    d.intervals = [first, second];
    d.draggedInterval = first;
    d.handleDrop({ preventDefault() {} }, second);
    assert.equal(d.intervals[1], first);
    d.handleDrop({ preventDefault() {} }, second);
    assert.equal(d.intervals[0], first);
});

test('live chart retains two minutes, independent of Bluetooth notification frequency', () => {
    const h = harness();
    vm.runInContext(`${readFileSync(join(__dirname, '../chart.js'), 'utf8')}\nglobalThis.LiveChart = LiveChart;`, h.context);
    const chart = Object.create(h.context.LiveChart.prototype);
    Object.assign(chart, { maxDataPoints: 120, powerData: [], hrData: [], targetPowerData: [], timestamps: [], draw() {} });
    for (let second = 0; second < 130; second++) {
        for (let packet = 0; packet < 4; packet++) {
            h.setTime(100000 + second * 1000 + packet * 200);
            chart.addDataPoint(200 + packet, 150, 200);
        }
    }
    assert.equal(chart.timestamps.length, 120);
    assert.equal(chart.timestamps.at(-1) - chart.timestamps[0], 119000);
    assert.equal(chart.powerData.at(-1), 203);
});

test('redesigned interface keeps unique element IDs and valid action handlers', () => {
    const h = harness();
    const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const match of html.matchAll(/\bon(?:click|change|input|submit)="([^"]+)"/g)) {
        for (const call of match[1].matchAll(/\b(app|workoutDesigner)\.(\w+)\(/g)) {
            const prototype = call[1] === 'app' ? h.context.App.prototype : h.context.WorkoutDesigner.prototype;
            assert.equal(typeof prototype[call[2]], 'function', `${call[1]}.${call[2]} exists`);
        }
    }
    for (const id of ['liveChart', 'workoutProgressChart', 'raceTrackCanvas', 'powerSlider', 'quickJoinName', 'workoutTimeline', 'devicesDialog', 'intervalDialog']) {
        assert.ok(ids.includes(id), `${id} exists`);
    }
});

test('countdown uses elapsed wall time, replaces old countdowns and cancels on session end', async () => {
    const h = harness();
    const app = Object.create(h.context.App.prototype);
    const starts = [];
    h.context.workoutDesigner = { isRunning: false, startWorkout: async time => starts.push(time) };
    app.log = () => {};
    app.handleSessionStart(115000);
    const oldTimer = app.countdownInterval;
    app.handleSessionStart(120000);
    assert.equal(h.timers.has(oldTimer), false);
    h.setTime(125000);
    await h.fire(app.countdownInterval);
    assert.deepEqual(starts, [120000]);
    assert.equal(h.timers.size, 0);
    app.handleSessionStart(140000);
    app.handleSessionEnd();
    assert.equal(h.timers.size, 0);
});
