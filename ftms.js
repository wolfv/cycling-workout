// FTMS Protocol Handler
class FTMSController {
    constructor() {
        this.device = null;
        this.server = null;
        this.controlPointChar = null;
        this.metrics = { power: 0, hr: 0, cadence: 0, timestamp: Date.now() };
        this.onMetricsUpdate = null;
        this.onLog = null;
    }

    // FTMS (Fitness Machine Service) UUIDs
    get FITNESS_MACHINE_SERVICE() { return 0x1826; }
    get FITNESS_MACHINE_CONTROL_POINT() { return 0x2AD9; }
    get FITNESS_MACHINE_STATUS() { return 0x2ADA; }
    get CYCLING_POWER_SERVICE() { return 0x1818; }
    get HEART_RATE_SERVICE() { return 0x180d; }
    get DEVICE_INFO_SERVICE() { return 0x180a; }

    log(msg, type = 'info') {
        if (this.onLog) {
            this.onLog(msg, type);
        }
    }

    async connect() {
        try {
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const isHttps = window.location.protocol === 'https:';
            if (!isLocalhost && !isHttps) {
                alert('Requires HTTPS or localhost');
                return false;
            }

            this.log('Scanning for Zwift Hub...', 'info');
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Zwift' }],
                optionalServices: [
                    this.FITNESS_MACHINE_SERVICE,
                    this.CYCLING_POWER_SERVICE,
                    this.HEART_RATE_SERVICE,
                    this.DEVICE_INFO_SERVICE
                ]
            });

            this.log(`Found: ${this.device.name}`, 'success');
            this.server = await this.device.gatt.connect();
            this.log('Connected to GATT server', 'success');

            await this.subscribeToMetrics();
            await this.initializeFTMS();

            return true;
        } catch (error) {
            if (error.name !== 'NotAllowedError') {
                this.log(`Error: ${error.message}`, 'error');
            }
            return false;
        }
    }

    async subscribeToMetrics() {
        try {
            const hrService = await this.server.getPrimaryService(this.HEART_RATE_SERVICE);
            const hrChar = await hrService.getCharacteristic(0x2a37);
            hrChar.addEventListener('characteristicvaluechanged', (e) => {
                const flags = e.target.value.getUint8(0);
                this.metrics.hr = flags & 0x01 ? e.target.value.getUint16(1, true) : e.target.value.getUint8(1);
                this.metrics.timestamp = Date.now();
                if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
            });
            await hrChar.startNotifications();
        } catch (e) { }

        try {
            const cpService = await this.server.getPrimaryService(this.CYCLING_POWER_SERVICE);
            const cpChar = await cpService.getCharacteristic(0x2a63);
            cpChar.addEventListener('characteristicvaluechanged', (e) => {
                try {
                    const dv = new DataView(e.target.value.buffer);
                    const flags = dv.getUint16(0, true);

                    // Power is always at offset 2
                    this.metrics.power = dv.getInt16(2, true);

                    // Check if Crank Revolution Data Present (bit 5 = 0x20)
                    let offset = 4;
                    if (flags & 0x20) {
                        // Crank revolution data present
                        const cumulativeCrankRevs = dv.getUint16(offset, true);
                        const lastCrankEventTime = dv.getUint16(offset + 2, true); // in 1/1024 seconds

                        // Calculate cadence from deltas (if we have previous values)
                        if (this.lastCrankRevs !== undefined) {
                            const revDelta = (cumulativeCrankRevs - this.lastCrankRevs) & 0xFFFF;
                            const timeDelta = ((lastCrankEventTime - this.lastCrankTime) & 0xFFFF) / 1024.0; // seconds

                            if (timeDelta > 0 && revDelta < 10) { // sanity check
                                this.metrics.cadence = Math.round((revDelta / timeDelta) * 60); // RPM
                            }
                        }

                        this.lastCrankRevs = cumulativeCrankRevs;
                        this.lastCrankTime = lastCrankEventTime;
                    }

                    this.metrics.timestamp = Date.now();
                    if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
                } catch (err) {
                    console.error('Power measurement parse error:', err);
                }
            });
            await cpChar.startNotifications();
            this.log('Subscribed to metrics', 'success');
        } catch (e) {
            this.log(`Metrics subscription: ${e.message}`, 'warning');
        }
    }

    async initializeFTMS() {
        try {
            this.log('Initializing FTMS...', 'info');
            const ftmsService = await this.server.getPrimaryService(this.FITNESS_MACHINE_SERVICE);

            // Get the control point characteristic
            this.controlPointChar = await ftmsService.getCharacteristic(this.FITNESS_MACHINE_CONTROL_POINT);

            // Subscribe to control point responses
            this.controlPointChar.addEventListener('characteristicvaluechanged', (e) => {
                const data = new Uint8Array(e.target.value.buffer);
                const responseStr = Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');

                // Decode response
                if (data[0] === 0x80) {
                    const opcode = data[1];
                    const result = data[2];
                    const resultCodes = ['', 'Success', 'Not Supported', 'Invalid Param', 'Failed', 'Control Not Permitted'];
                    this.log(`FTMS Response: ${responseStr} (${resultCodes[result] || 'Unknown'})`, result === 0x01 ? 'success' : 'error');
                } else {
                    this.log(`FTMS Response: ${responseStr}`, 'info');
                }
            });
            await this.controlPointChar.startNotifications();

            // Send Request Control command (0x00) - no parameters needed
            const requestControl = new Uint8Array([0x00]);
            await this.controlPointChar.writeValue(requestControl);
            this.log('Sent Request Control (0x00)', 'info');

            // Wait for response
            await new Promise(resolve => setTimeout(resolve, 200));

        } catch (e) {
            this.log(`FTMS init error: ${e.message}`, 'error');
        }
    }

    async sendCommand(data) {
        try {
            if (!this.controlPointChar) {
                this.log('FTMS not initialized', 'error');
                return false;
            }

            await this.controlPointChar.writeValue(data);
            return true;
        } catch (error) {
            this.log(`Write failed: ${error.message}`, 'error');
            return false;
        }
    }

    async setTargetPower(power) {
        const data = new Uint8Array(3);
        data[0] = 0x05; // Set Target Power opcode
        data[1] = power & 0xFF; // Power low byte
        data[2] = (power >> 8) & 0xFF; // Power high byte
        return await this.sendCommand(data);
    }

    disconnect() {
        if (this.device) {
            this.device.gatt.disconnect();
            this.device = null;
            this.server = null;
            this.controlPointChar = null;
            this.log('Disconnected', 'info');
        }
    }

    isConnected() {
        return this.device && this.device.gatt.connected;
    }
}
