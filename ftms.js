// FTMS Protocol Handler
class FTMSController {
    constructor() {
        this.device = null;
        this.server = null;
        this.controlPointChar = null;
        this.metrics = { power: 0, hr: 0, cadence: 0, timestamp: Date.now() };
        this.onMetricsUpdate = null;
        this.onLog = null;
        this.lastDeviceId = null;
        this.onConnectionChange = null;
        this.ready = false;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.commandQueue = Promise.resolve();
        this.pendingResponse = null;
        this.connectionGeneration = 0;
        this.targetSequence = 0;
        this.notificationController = null;
        this.handleTrainerDisconnect = (event) => {
            if (event.target !== this.device) return;
            this.connectionGeneration++;
            this.ready = false;
            this.notificationController?.abort();
            this.resetCadence();
            this.server = null;
            this.controlPointChar = null;
            if (this.pendingResponse) this.pendingResponse.finish(false);
            this.metrics = { power: 0, hr: 0, cadence: 0, timestamp: Date.now() };
            this.onMetricsUpdate?.(this.metrics);
            this.onConnectionChange?.(false);
            this.log('Trainer disconnected; attempting to reconnect...', 'warning');
            this.scheduleReconnect();
        };

        this.resetCadence();

        // Secondary heart rate monitor
        this.hrmDevice = null;
        this.hrmServer = null;

        // Track if trainer provides HR data
        this.hasTrainerHR = false;
    }

    // Save last connected device to localStorage
    saveLastDevice() {
        if (this.device && this.device.id) {
            const deviceInfo = {
                id: this.device.id,
                name: this.device.name
            };
            try {
                localStorage.setItem('lastBluetoothDevice', JSON.stringify(deviceInfo));
            } catch (error) {
                this.log('Could not save paired device', 'warning');
            }
            this.log(`Saved device: ${this.device.name}`, 'info');
        }
    }

    // Get saved device info
    getLastDevice() {
        try {
            const saved = localStorage.getItem('lastBluetoothDevice');
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            return null;
        }
    }

    // Try to reconnect to last device
    async reconnectToLastDevice() {
        const lastDevice = this.getLastDevice();
        if (!lastDevice) {
            return false;
        }

        try {
            this.log(`Reconnecting to ${lastDevice.name}...`, 'info');

            // Get all previously paired devices
            const devices = await navigator.bluetooth.getDevices();
            const savedDevice = devices.find(d => d.id === lastDevice.id);

            if (!savedDevice) {
                this.log('Device not found in paired devices', 'warning');
                return false;
            }

            return await this.connectToDevice(savedDevice);
        } catch (error) {
            this.log(`Reconnection failed: ${error.message}`, 'warning');
            return false;
        }
    }

    async connectToDevice(device) {
        const generation = ++this.connectionGeneration;
        this.notificationController?.abort();
        this.notificationController = new AbortController();
        this.device = device;
        this.ready = false;
        device.removeEventListener('gattserverdisconnected', this.handleTrainerDisconnect);
        device.addEventListener('gattserverdisconnected', this.handleTrainerDisconnect);
        try {
            const server = await device.gatt.connect();
            if (generation !== this.connectionGeneration) {
                if (this.device !== device) device.gatt.disconnect();
                return false;
            }
            this.server = server;
            this.resetCadence();
            this.hasTrainerHR = false;
            await this.subscribeToMetrics();
            if (generation !== this.connectionGeneration || !device.gatt.connected) return false;
            await this.initializeFTMS();
            if (generation !== this.connectionGeneration || !device.gatt.connected) return false;
            this.ready = true;
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
            this.reconnectAttempts = 0;
            this.log(`Trainer ready: ${device.name}`, 'success');
            this.onConnectionChange?.(true);
            return true;
        } catch (error) {
            if (generation === this.connectionGeneration) {
                this.controlPointChar = null;
                device.gatt.disconnect();
            }
            throw error;
        }
    }

    scheduleReconnect() {
        if (!this.device || this.reconnectTimer || this.reconnectAttempts >= 5) {
            if (this.reconnectAttempts >= 5) this.log('Reconnect failed. Use Connect to try again.', 'error');
            return;
        }
        const device = this.device;
        const timer = setTimeout(async () => {
            this.reconnectAttempts++;
            try {
                if (this.device === device) await this.connectToDevice(device);
            } catch (error) {
                this.log(`Reconnect attempt ${this.reconnectAttempts}: ${error.message}`, 'warning');
            } finally {
                if (this.reconnectTimer === timer) {
                    this.reconnectTimer = null;
                    if (this.device === device && !this.ready) this.scheduleReconnect();
                }
            }
        }, Math.min(1000 * 2 ** this.reconnectAttempts, 10000));
        this.reconnectTimer = timer;
    }

    // FTMS (Fitness Machine Service) UUIDs
    get FITNESS_MACHINE_SERVICE() { return 0x1826; }
    get FITNESS_MACHINE_CONTROL_POINT() { return 0x2AD9; }
    get FITNESS_MACHINE_STATUS() { return 0x2ADA; }
    get CYCLING_POWER_SERVICE() { return 0x1818; }
    get CYCLING_SPEED_CADENCE_SERVICE() { return 0x1816; }
    get HEART_RATE_SERVICE() { return 0x180d; }
    get DEVICE_INFO_SERVICE() { return 0x180a; }

    log(msg, type = 'info') {
        if (this.onLog) {
            this.onLog(msg, type);
        }
    }

    // Identify trainer brand from device name
    getTrainerBrand(deviceName) {
        const name = deviceName.toUpperCase();

        if (name.includes('ZWIFT')) return 'Zwift';
        if (name.includes('KICKR') || name.includes('WAHOO')) return 'Wahoo';
        if (name.includes('TACX') || name.includes('NEO') || name.includes('FLUX')) return 'Tacx';
        if (name.includes('ELITE') || name.includes('DRIVO') || name.includes('DIRETO') || name.includes('SUITO')) return 'Elite';
        if (name.includes('SARIS') || name.includes('H3') || name.includes('H2')) return 'Saris';
        if (name.includes('JETBLACK') || name.includes('VOLT')) return 'JetBlack';
        if (name.includes('KINETIC')) return 'Kinetic';
        if (name.includes('BKOOL')) return 'Bkool';
        if (name.includes('WATTBIKE') || name.includes('ATOM')) return 'Wattbike';

        return 'Unknown';
    }

    async connect() {
        if (this.isConnected()) return true;
        if (this.device) this.disconnect();
        try {
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const isHttps = window.location.protocol === 'https:';
            if (!isLocalhost && !isHttps) {
                alert('Requires HTTPS or localhost');
                return false;
            }

            this.log('Scanning for smart trainers...', 'info');

            // Support popular smart trainers via FTMS
            const device = await navigator.bluetooth.requestDevice({
                filters: [
                    // Zwift trainers
                    { namePrefix: 'Zwift' },
                    // Wahoo trainers
                    { namePrefix: 'KICKR' },
                    { namePrefix: 'Wahoo' },
                    // Tacx trainers
                    { namePrefix: 'Tacx' },
                    { namePrefix: 'NEO' },
                    { namePrefix: 'Flux' },
                    // Elite trainers
                    { namePrefix: 'Elite' },
                    { namePrefix: 'DRIVO' },
                    { namePrefix: 'DIRETO' },
                    { namePrefix: 'SUITO' },
                    // Saris trainers
                    { namePrefix: 'Saris' },
                    { namePrefix: 'H3' },
                    { namePrefix: 'H2' },
                    // JetBlack trainers
                    { namePrefix: 'JetBlack' },
                    { namePrefix: 'VOLT' },
                    // Kinetic trainers
                    { namePrefix: 'Kinetic' },
                    { namePrefix: 'ROCK AND ROLL' },
                    // Bkool trainers
                    { namePrefix: 'BKOOL' },
                    // Wattbike
                    { namePrefix: 'WATTBIKE' },
                    { namePrefix: 'Atom' }
                ],
                optionalServices: [
                    this.FITNESS_MACHINE_SERVICE,
                    this.CYCLING_POWER_SERVICE,
                    this.CYCLING_SPEED_CADENCE_SERVICE,
                    this.HEART_RATE_SERVICE,
                    this.DEVICE_INFO_SERVICE
                ]
            });

            this.log(`Found: ${device.name}`, 'success');
            if (!await this.connectToDevice(device)) return false;

            // Save device for auto-reconnect
            this.saveLastDevice();

            return true;
        } catch (error) {
            if (error.name !== 'NotAllowedError') {
                this.log(`Error: ${error.message}`, 'error');
            }
            return false;
        }
    }

    // Connect to a separate heart rate monitor
    async connectHRM() {
        try {
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const isHttps = window.location.protocol === 'https:';
            if (!isLocalhost && !isHttps) {
                alert('Requires HTTPS or localhost');
                return false;
            }

            this.log('Scanning for heart rate monitors...', 'info');

            this.hrmDevice = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: [this.HEART_RATE_SERVICE] }
                ],
                optionalServices: [
                    this.HEART_RATE_SERVICE,
                    this.DEVICE_INFO_SERVICE
                ]
            });

            this.log(`Found HR monitor: ${this.hrmDevice.name}`, 'success');
            this.hrmServer = await this.hrmDevice.gatt.connect();
            this.log('Connected to HR monitor', 'success');

            // Subscribe to heart rate notifications
            const hrService = await this.hrmServer.getPrimaryService(this.HEART_RATE_SERVICE);
            const hrChar = await hrService.getCharacteristic(0x2a37);
            hrChar.addEventListener('characteristicvaluechanged', (e) => {
                const flags = e.target.value.getUint8(0);
                this.metrics.hr = flags & 0x01 ? e.target.value.getUint16(1, true) : e.target.value.getUint8(1);
                this.metrics.timestamp = Date.now();
                if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
            });
            await hrChar.startNotifications();
            this.log('Subscribed to Heart Rate from HRM device', 'success');

            return true;
        } catch (error) {
            if (error.name !== 'NotAllowedError') {
                this.log(`HRM Error: ${error.message}`, 'error');
            }
            return false;
        }
    }

    disconnectHRM() {
        if (this.hrmDevice && this.hrmDevice.gatt) {
            this.hrmDevice.gatt.disconnect();
            this.hrmDevice = null;
            this.hrmServer = null;
            this.log('HR monitor disconnected', 'info');
        }
    }

    isHRMConnected() {
        return this.hrmDevice && this.hrmDevice.gatt && this.hrmDevice.gatt.connected;
    }

    resetCadence() {
        clearTimeout(this.cadenceTimer);
        this.cadenceTimer = null;
        this.cadenceSource = null;
        this.cadenceUpdatedAt = 0;
        this.crankSamples = {};
        this.metrics.cadence = 0;
        this.metrics.cadenceSource = null;
    }

    updateCadence(source, rpm) {
        if (!Number.isFinite(rpm) || rpm < 0 || rpm > 300) return;
        const priority = { ftms: 0, csc: 1, power: 2 };
        const now = Date.now();
        if (this.cadenceSource && priority[source] > priority[this.cadenceSource] && now - this.cadenceUpdatedAt < 3000) return;
        this.cadenceSource = source;
        this.cadenceUpdatedAt = now;
        this.metrics.cadence = Math.round(rpm);
        this.metrics.cadenceSource = source;
        clearTimeout(this.cadenceTimer);
        this.cadenceTimer = setTimeout(() => {
            this.cadenceSource = null;
            this.metrics.cadence = 0;
            this.metrics.cadenceSource = null;
            this.onMetricsUpdate?.(this.metrics);
        }, 3000);
    }

    updateCrankCadence(source, revolutions, ticks) {
        const previous = this.crankSamples[source];
        const now = Date.now();
        if (previous && revolutions === previous.revolutions && ticks === previous.ticks) {
            if (now - previous.changedAt >= 3000) this.updateCadence(source, 0);
            return;
        }
        this.crankSamples[source] = { revolutions, ticks, changedAt: now };
        if (!previous || now - previous.changedAt > 64000) return;
        const revDelta = (revolutions - previous.revolutions) & 0xffff;
        const tickDelta = (ticks - previous.ticks) & 0xffff;
        // Both CSC and Cycling Power crank clocks use 1/1024 s (wheel clocks differ).
        if (tickDelta > 0 && revDelta > 0) this.updateCadence(source, revDelta * 60 * 1024 / tickDelta);
    }

    async subscribeToMetrics() {
        const server = this.server;
        const signal = this.notificationController.signal;
        // Try to subscribe to FTMS Indoor Bike Data first (most common for cadence)
        try {
            const ftmsService = await server.getPrimaryService(this.FITNESS_MACHINE_SERVICE);
            const indoorBikeChar = await ftmsService.getCharacteristic(0x2AD2); // Indoor Bike Data

            indoorBikeChar.addEventListener('characteristicvaluechanged', (e) => {
                try {
                    const dv = e.target.value;
                    const flags = dv.getUint16(0, true);
                    // Optional field sizes in flag-bit order (bits 1–12).
                    const fieldLengths = [2, 2, 2, 3, 2, 2, 2, 5, 1, 1, 2, 2];
                    let requiredLength = (flags & 1) ? 2 : 4;
                    for (let bit = 1; bit <= 12; bit++) {
                        if (flags & (1 << bit)) requiredLength += fieldLengths[bit - 1];
                    }
                    if (dv.byteLength < requiredLength) throw new Error('Truncated Indoor Bike Data');

                    let offset = 2;

                    // Instantaneous Speed Present (bit 0 = 0 means speed IS present, inverted logic!)
                    if (!(flags & 0x01)) {
                        offset += 2; // Skip speed
                    }

                    // Average Speed Present (bit 1)
                    if (flags & 0x02) {
                        offset += 2; // Skip average speed
                    }

                    // Instantaneous Cadence Present (bit 2)
                    if (flags & 0x04) {
                        // FTMS Instantaneous Cadence has a resolution of 0.5 RPM.
                        this.updateCadence('ftms', dv.getUint16(offset, true) / 2);
                        offset += 2;
                    }

                    // Average Cadence Present (bit 3)
                    if (flags & 0x08) {
                        offset += 2;
                    }

                    // Total Distance Present (bit 4)
                    if (flags & 0x10) {
                        offset += 3; // 24-bit field
                    }

                    // Resistance Level Present (bit 5)
                    if (flags & 0x20) {
                        offset += 2; // Skip resistance
                    }

                    // Instantaneous Power Present (bit 6)
                    if (flags & 0x40) {
                        const power = dv.getInt16(offset, true);
                        // Use Indoor Bike Data power as primary source
                        this.metrics.power = power;
                        offset += 2;
                    }

                    // Average Power Present (bit 7)
                    if (flags & 0x80) {
                        offset += 2;
                    }

                    // Expended Energy includes all three fields under bit 8.
                    if (flags & 0x100) offset += 5;
                    if (flags & 0x200) { // Heart Rate (bit 9)
                        const hr = dv.getUint8(offset);
                        if (hr > 0) {
                            this.metrics.hr = hr;
                        }
                        offset += 1;
                    }

                    this.metrics.timestamp = Date.now();
                    if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
                } catch (err) {
                    console.error('Indoor Bike Data parse error:', err);
                }
            }, { signal });

            await indoorBikeChar.startNotifications();
            this.log('Subscribed to Indoor Bike Data (cadence, power)', 'success');
        } catch (e) {
            this.log(`Indoor Bike Data: ${e.message}`, 'warning');
        }

        // Subscribe to Cycling Speed and Cadence Service (for cadence)
        try {
            this.log('Attempting to connect to CSC Service...', 'info');
            const cscService = await server.getPrimaryService(this.CYCLING_SPEED_CADENCE_SERVICE);
            this.log('Found CSC Service, getting characteristic...', 'info');
            const cscChar = await cscService.getCharacteristic(0x2A5B); // CSC Measurement
            this.log('Found CSC Measurement characteristic', 'info');

            cscChar.addEventListener('characteristicvaluechanged', (e) => {
                try {
                    const dv = e.target.value;
                    const flags = dv.getUint8(0);

                    let offset = 1;

                    // Wheel Revolution Data Present (bit 0)
                    if (flags & 0x01) {
                        offset += 6; // Skip wheel data (4 bytes revs + 2 bytes time)
                    }

                    // Crank Revolution Data Present (bit 1)
                    if (flags & 0x02) {
                        this.updateCrankCadence('csc', dv.getUint16(offset, true), dv.getUint16(offset + 2, true));
                    }

                    this.metrics.timestamp = Date.now();
                    if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
                } catch (err) {
                    console.error('CSC Measurement parse error:', err);
                }
            }, { signal });

            await cscChar.startNotifications();
            this.log('Subscribed to Cycling Speed and Cadence (cadence)', 'success');
        } catch (e) {
            this.log(`Cycling Speed and Cadence: ${e.message}`, 'warning');
        }

        // Subscribe to Heart Rate
        try {
            const hrService = await server.getPrimaryService(this.HEART_RATE_SERVICE);
            const hrChar = await hrService.getCharacteristic(0x2a37);
            hrChar.addEventListener('characteristicvaluechanged', (e) => {
                const flags = e.target.value.getUint8(0);
                this.metrics.hr = flags & 0x01 ? e.target.value.getUint16(1, true) : e.target.value.getUint8(1);
                this.metrics.timestamp = Date.now();
                if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
            }, { signal });
            await hrChar.startNotifications();
            this.hasTrainerHR = true;
            this.log('Subscribed to Heart Rate', 'success');
        } catch (e) {
            this.hasTrainerHR = false;
            this.log(`Heart Rate: ${e.message}`, 'warning');
        }

        // Also try Cycling Power Service as fallback (for cadence from crank revolutions)
        try {
            const cpService = await server.getPrimaryService(this.CYCLING_POWER_SERVICE);
            const cpChar = await cpService.getCharacteristic(0x2a63);
            cpChar.addEventListener('characteristicvaluechanged', (e) => {
                try {
                    const dv = e.target.value;
                    const flags = dv.getUint16(0, true);

                    // Power is always at offset 2
                    const power = dv.getInt16(2, true);
                    // console.log('Power from Cycling Power Service at offset 2:', power, 'W');

                    // Only use Cycling Power if valid (non-zero), otherwise keep Indoor Bike Data power
                    if (power > 0) {
                        this.metrics.power = power;
                    }

                    // Calculate offset for optional fields (same approach as debug.html)
                    let offset = 4; // Start after flags (2) + power (2)

                    // Skip Pedal Power Balance (bit 0 = 0x01)
                    if (flags & 0x01) {
                        offset += 1;
                    }

                    // Skip Accumulated Torque (bit 2 = 0x04)
                    if (flags & 0x04) {
                        offset += 2;
                    }

                    // Skip Wheel Revolution Data (bit 4 = 0x10)
                    if (flags & 0x10) {
                        offset += 6; // 4 bytes wheel revs + 2 bytes wheel time
                    }

                    // Crank Revolution Data (bit 5 = 0x20)
                    if (flags & 0x20) {
                        this.updateCrankCadence('power', dv.getUint16(offset, true), dv.getUint16(offset + 2, true));
                    }
                    // Note: If no crank data in Cycling Power, Indoor Bike Data will provide cadence

                    this.metrics.timestamp = Date.now();
                    if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
                } catch (err) {
                    console.error('Power measurement parse error:', err);
                }
            }, { signal });
            await cpChar.startNotifications();
            this.log('Subscribed to Cycling Power Service', 'success');
        } catch (e) {
            this.log(`Cycling Power Service: ${e.message}`, 'warning');
        }
    }

    async initializeFTMS() {
        try {
            this.log('Initializing FTMS...', 'info');
            const server = this.server;
            const signal = this.notificationController.signal;
            const ftmsService = await server.getPrimaryService(this.FITNESS_MACHINE_SERVICE);
            const characteristic = await ftmsService.getCharacteristic(this.FITNESS_MACHINE_CONTROL_POINT);
            if (signal.aborted || this.server !== server) throw new Error('Connection cancelled');
            this.controlPointChar = characteristic;

            // Subscribe to control point responses
            this.controlPointChar.addEventListener('characteristicvaluechanged', (e) => {
                const value = e.target.value;
                const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
                const responseStr = Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');

                // Decode response
                if (data[0] === 0x80) {
                    const opcode = data[1];
                    const result = data[2];
                    if (this.pendingResponse?.opcode === opcode && this.pendingResponse.characteristic === e.target) {
                        this.pendingResponse.finish(result === 0x01);
                    }
                    const resultCodes = ['', 'Success', 'Not Supported', 'Invalid Param', 'Failed', 'Control Not Permitted'];
                    this.log(`FTMS Response: ${responseStr} (${resultCodes[result] || 'Unknown'})`, result === 0x01 ? 'success' : 'error');
                } else {
                    this.log(`FTMS Response: ${responseStr}`, 'info');
                }
            }, { signal });
            await this.controlPointChar.startNotifications();

            // Send Request Control command (0x00) - no parameters needed
            const requestControl = new Uint8Array([0x00]);
            if (!await this.sendCommand(requestControl)) throw new Error('Trainer did not grant FTMS control');

        } catch (e) {
            this.log(`FTMS init error: ${e.message}`, 'error');
            throw e;
        }
    }

    sendCommand(data) {
        const characteristic = this.controlPointChar;
        const generation = this.connectionGeneration;
        const targetSequence = data[0] === 0x05 ? ++this.targetSequence : null;
        // FTMS allows one outstanding control procedure, not concurrent GATT writes.
        this.commandQueue = this.commandQueue.then(async () => {
            if (generation !== this.connectionGeneration || !characteristic || characteristic !== this.controlPointChar || !this.device?.gatt.connected) return false;
            if (targetSequence !== null && targetSequence !== this.targetSequence) return false;
            let timer;
            const response = new Promise(resolve => {
                this.pendingResponse = { characteristic, opcode: data[0], finish: resolve };
            });
            const deadline = new Promise(resolve => {
                timer = setTimeout(() => {
                    resolve(false);
                    // A late acknowledgement cannot safely be matched to the next command.
                    if (characteristic === this.controlPointChar) this.device?.gatt.disconnect();
                }, 5000);
            });
            try {
                // Wait for both GATT completion and the FTMS response, but bound either stall.
                const success = await Promise.race([
                    Promise.all([characteristic.writeValue(data), response]).then(([, accepted]) => accepted),
                    deadline
                ]);
                if (!success) this.log('Trainer command failed or timed out', 'error');
                return success;
            } catch (error) {
                this.log(`Write failed: ${error.message}`, 'error');
                return false;
            } finally {
                clearTimeout(timer);
                this.pendingResponse = null;
            }
        });
        return this.commandQueue;
    }

    async setTargetPower(power) {
        if (!this.ready || !Number.isFinite(power) || power < 0 || power > 32767) return false;
        const data = new Uint8Array(3);
        data[0] = 0x05; // Set Target Power opcode
        data[1] = power & 0xFF; // Power low byte
        data[2] = (power >> 8) & 0xFF; // Power high byte
        return await this.sendCommand(data);
    }

    disconnect() {
        this.connectionGeneration++;
        this.notificationController?.abort();
        this.resetCadence();
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.ready = false;
        if (this.pendingResponse) this.pendingResponse.finish(false);
        if (this.device) {
            this.device.removeEventListener('gattserverdisconnected', this.handleTrainerDisconnect);
            this.device.gatt.disconnect();
            this.device = null;
            this.log('Disconnected', 'info');
        }
        this.server = null;
        this.controlPointChar = null;
        this.hasTrainerHR = false;
        this.onConnectionChange?.(false);
        // Also disconnect HRM if connected
        this.disconnectHRM();
    }

    isConnected() {
        return Boolean(this.ready && this.device?.gatt.connected);
    }
}
