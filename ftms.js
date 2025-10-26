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
    }

    // Save last connected device to localStorage
    saveLastDevice() {
        if (this.device && this.device.id) {
            const deviceInfo = {
                id: this.device.id,
                name: this.device.name
            };
            localStorage.setItem('lastBluetoothDevice', JSON.stringify(deviceInfo));
            this.log(`Saved device: ${this.device.name}`, 'info');
        }
    }

    // Get saved device info
    getLastDevice() {
        const saved = localStorage.getItem('lastBluetoothDevice');
        return saved ? JSON.parse(saved) : null;
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

            // Check if device is in range by trying to connect
            if (!savedDevice.gatt.connected) {
                this.device = savedDevice;
                this.server = await this.device.gatt.connect();
                this.log(`Reconnected to ${this.device.name}!`, 'success');

                await this.subscribeToMetrics();
                await this.initializeFTMS();

                return true;
            }

            return false;
        } catch (error) {
            this.log(`Reconnection failed: ${error.message}`, 'warning');
            return false;
        }
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
        try {
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const isHttps = window.location.protocol === 'https:';
            if (!isLocalhost && !isHttps) {
                alert('Requires HTTPS or localhost');
                return false;
            }

            this.log('Scanning for smart trainers...', 'info');

            // Support popular smart trainers via FTMS
            this.device = await navigator.bluetooth.requestDevice({
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

            this.log(`Found: ${this.device.name}`, 'success');
            this.server = await this.device.gatt.connect();
            this.log('Connected to GATT server', 'success');

            await this.subscribeToMetrics();
            await this.initializeFTMS();

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

    async subscribeToMetrics() {
        // Try to subscribe to FTMS Indoor Bike Data first (most common for cadence)
        try {
            const ftmsService = await this.server.getPrimaryService(this.FITNESS_MACHINE_SERVICE);
            const indoorBikeChar = await ftmsService.getCharacteristic(0x2AD2); // Indoor Bike Data

            indoorBikeChar.addEventListener('characteristicvaluechanged', (e) => {
                try {
                    const dv = new DataView(e.target.value.buffer);
                    const flags = dv.getUint16(0, true);

                    let offset = 2;

                    // Instantaneous Speed Present (bit 0)
                    if (flags & 0x01) {
                        offset += 2; // Skip speed
                    }

                    // Average Speed Present (bit 1)
                    if (flags & 0x02) {
                        offset += 2; // Skip average speed
                    }

                    // Instantaneous Cadence Present (bit 2)
                    if (flags & 0x04) {
                        // NOTE: This field doesn't seem to be real cadence on Zwift Hub, ignoring it
                        // Will use Cycling Power Service crank revolutions instead
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
                        // NOTE: Power from Indoor Bike Data seems incorrect (stuck at 20W)
                        // Using Cycling Power Service instead
                        offset += 2;
                    }

                    // Average Power Present (bit 7)
                    if (flags & 0x80) {
                        offset += 2;
                    }

                    // Extended Energy fields (bits 8-11)
                    if (flags & 0x100) { // Total Energy
                        offset += 2;
                    }
                    if (flags & 0x200) { // Energy Per Hour
                        offset += 2;
                    }
                    if (flags & 0x400) { // Energy Per Minute
                        offset += 1;
                    }
                    if (flags & 0x800) { // Heart Rate
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
            });

            await indoorBikeChar.startNotifications();
            this.log('Subscribed to Indoor Bike Data (cadence, power)', 'success');
        } catch (e) {
            this.log(`Indoor Bike Data: ${e.message}`, 'warning');
        }

        // Subscribe to Cycling Speed and Cadence Service (for cadence)
        try {
            this.log('Attempting to connect to CSC Service...', 'info');
            const cscService = await this.server.getPrimaryService(this.CYCLING_SPEED_CADENCE_SERVICE);
            this.log('Found CSC Service, getting characteristic...', 'info');
            const cscChar = await cscService.getCharacteristic(0x2A5B); // CSC Measurement
            this.log('Found CSC Measurement characteristic', 'info');

            cscChar.addEventListener('characteristicvaluechanged', (e) => {
                try {
                    const dv = new DataView(e.target.value.buffer);
                    const flags = dv.getUint8(0);

                    const bytes = new Uint8Array(e.target.value.buffer);
                    const hexDump = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
                    console.log('CSC Measurement:', hexDump, 'flags:', '0x' + flags.toString(16).padStart(2, '0'));

                    let offset = 1;

                    // Wheel Revolution Data Present (bit 0)
                    if (flags & 0x01) {
                        offset += 6; // Skip wheel data (4 bytes revs + 2 bytes time)
                    }

                    // Crank Revolution Data Present (bit 1)
                    if (flags & 0x02) {
                        const cumulativeCrankRevs = dv.getUint16(offset, true);
                        const lastCrankEventTime = dv.getUint16(offset + 2, true); // in 1/1024 seconds

                        console.log('CSC Crank revs:', cumulativeCrankRevs, 'time:', lastCrankEventTime);

                        // Calculate cadence from deltas
                        if (this.lastCSCCrankRevs !== undefined && this.lastCSCCrankTime !== undefined) {
                            const revDelta = (cumulativeCrankRevs - this.lastCSCCrankRevs) & 0xFFFF;
                            const timeDelta = ((lastCrankEventTime - this.lastCSCCrankTime) & 0xFFFF) / 1024.0;

                            console.log('CSC Delta revs:', revDelta, 'delta time:', timeDelta.toFixed(3), 's');

                            if (timeDelta > 0 && revDelta > 0 && revDelta < 20) {
                                // Zwift Hub counts both pedal strokes, so divide by 2 for actual cadence
                                const cadence = Math.round((revDelta / timeDelta) * 60 / 2); // RPM
                                this.metrics.cadence = cadence;
                                console.log('Cadence from CSC:', cadence, 'RPM (raw:', Math.round((revDelta / timeDelta) * 60), ')');

                                // Store last valid cadence and timestamp for timeout detection
                                this.lastValidCadence = cadence;
                                this.lastValidCadenceTime = Date.now();
                            } else if (timeDelta === 0 && revDelta === 0) {
                                // Duplicate packet - keep current cadence but check for timeout
                                if (this.lastValidCadenceTime && (Date.now() - this.lastValidCadenceTime) > 2000) {
                                    // No new data for 2 seconds, user stopped pedaling
                                    this.metrics.cadence = 0;
                                }
                                // Otherwise keep the last valid cadence
                            }
                        }

                        this.lastCSCCrankRevs = cumulativeCrankRevs;
                        this.lastCSCCrankTime = lastCrankEventTime;
                    }

                    this.metrics.timestamp = Date.now();
                    if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
                } catch (err) {
                    console.error('CSC Measurement parse error:', err);
                }
            });

            await cscChar.startNotifications();
            this.log('Subscribed to Cycling Speed and Cadence (cadence)', 'success');
        } catch (e) {
            this.log(`Cycling Speed and Cadence: ${e.message}`, 'warning');
        }

        // Subscribe to Heart Rate
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
            this.log('Subscribed to Heart Rate', 'success');
        } catch (e) {
            this.log(`Heart Rate: ${e.message}`, 'warning');
        }

        // Also try Cycling Power Service as fallback (for cadence from crank revolutions)
        try {
            const cpService = await this.server.getPrimaryService(this.CYCLING_POWER_SERVICE);
            const cpChar = await cpService.getCharacteristic(0x2a63);
            cpChar.addEventListener('characteristicvaluechanged', (e) => {
                try {
                    const dv = new DataView(e.target.value.buffer);
                    const flags = dv.getUint16(0, true);

                    // Debug: log raw bytes
                    const bytes = new Uint8Array(e.target.value.buffer);
                    const hexDump = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
                    console.log('Cycling Power:', hexDump, 'flags:', '0x' + flags.toString(16).padStart(4, '0'));

                    // Power is always at offset 2
                    const power = dv.getInt16(2, true);
                    console.log('Power from Cycling Power Service at offset 2:', power, 'W');

                    // Use Cycling Power Service as primary source for power
                    this.metrics.power = power;

                    // Check if Crank Revolution Data Present (bit 5 = 0x20)
                    let offset = 4;
                    if (flags & 0x20) {
                        // Crank revolution data present
                        // Zwift Hub uses 32-bit cumulative crank revolutions (non-standard)
                        const cumulativeCrankRevs = dv.getUint32(offset, true);
                        const lastCrankEventTime = dv.getUint16(offset + 4, true); // in 1/1024 seconds

                        // Calculate cadence from deltas (if we have previous values)
                        if (this.lastCrankRevs !== undefined && this.lastCrankTime !== undefined) {
                            const revDelta = cumulativeCrankRevs - this.lastCrankRevs;
                            const timeDelta = ((lastCrankEventTime - this.lastCrankTime) & 0xFFFF) / 1024.0; // seconds

                            console.log('CP Crank data - revs:', cumulativeCrankRevs, 'time:', lastCrankEventTime,
                                        'delta revs:', revDelta, 'delta time:', timeDelta.toFixed(3), 's');

                            if (timeDelta > 0 && revDelta > 0 && revDelta < 20) { // sanity check (increased limit since we're getting 2x)
                                // Zwift Hub counts both pedal strokes, so divide by 2 for actual cadence
                                const cadence = Math.round((revDelta / timeDelta) * 60 / 2); // RPM
                                this.metrics.cadence = cadence;
                                console.log('Cadence from Cycling Power:', cadence, 'RPM (raw:', Math.round((revDelta / timeDelta) * 60), ')');

                                this.lastValidCadence = cadence;
                                this.lastValidCadenceTime = Date.now();
                            } else if (timeDelta === 0 && revDelta === 0) {
                                // Duplicate - keep cadence but check timeout
                                if (this.lastValidCadenceTime && (Date.now() - this.lastValidCadenceTime) > 2000) {
                                    this.metrics.cadence = 0;
                                }
                            }
                        }

                        this.lastCrankRevs = cumulativeCrankRevs;
                        this.lastCrankTime = lastCrankEventTime;

                        offset += 6; // Skip past crank data
                    } else {
                        // No crank data in this packet
                        if (this.lastValidCadenceTime && (Date.now() - this.lastValidCadenceTime) > 2000) {
                            this.metrics.cadence = 0;
                        }
                    }

                    this.metrics.timestamp = Date.now();
                    if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
                } catch (err) {
                    console.error('Power measurement parse error:', err);
                }
            });
            await cpChar.startNotifications();
            this.log('Subscribed to Cycling Power Service', 'success');
        } catch (e) {
            this.log(`Cycling Power Service: ${e.message}`, 'warning');
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
