// Main Application
class App {
    constructor() {
        this.ftms = new FTMSController();
        this.chart = new LiveChart('liveChart', 120); // 2 minutes of data
        this.currentTab = 'ride';
    this.quickControlMode = 'power';
    this.manualTargetPower = 100;
    this.activeIntensityPercent = 100;
    this.pendingIntensityPercent = 100;
        this.quickControlElements = {
            slider: null,
            display: null,
            label: null,
            button: null,
            buttonText: null
        };

        // Setup FTMS callbacks
        this.ftms.onLog = (msg, type) => this.log(msg, type);
        this.ftms.onMetricsUpdate = (metrics) => this.handleMetricsUpdate(metrics);

        // Initialize workout designer
        window.workoutDesigner = new WorkoutDesigner(this.ftms);
    const initialIntensityPercent = Math.max(50, Math.min(150, Math.round(window.workoutDesigner.intensityScale * 100)));
    this.activeIntensityPercent = initialIntensityPercent;
    this.pendingIntensityPercent = initialIntensityPercent;
        window.workoutDesigner.onTargetPowerChange = (power) => {
            this.updateTargetPowerUI(power);
        };
        window.workoutDesigner.onWorkoutStart = () => this.handleWorkoutStart();
        window.workoutDesigner.onWorkoutStop = () => this.handleWorkoutStop();
        window.workoutDesigner.onIntensityScaleChange = (scale) => this.handleIntensityScaleChange(scale);

        // Initialize session manager
        this.sessionManager = new P2PSessionManager();
        this.sessionManager.onParticipantUpdate = (participants) => this.handleParticipantUpdate(participants);
        this.sessionManager.onSessionStart = (startTime) => this.handleSessionStart(startTime);
        this.sessionManager.onSessionEnd = () => this.handleSessionEnd();
        this.sessionManager.onWorkoutReceived = (workout) => this.handleWorkoutReceived(workout);

        // Initialize race track visualizer
        this.raceTrack = new RaceTrackVisualizer('raceTrackCanvas');

        // Initialize workout recorder
        this.workoutRecorder = new WorkoutRecorder();

    // Initialize quick control UI
    this.initQuickControl();

        // Metrics broadcast interval
        this.metricsBroadcastInterval = null;

        // Load workout library
        this.refreshWorkoutLibrary();

        // Attempt to restore session from localStorage
        this.attemptSessionRestore();

        // Load saved rider name or generate a fun one
        this.loadRiderName();

        // Auto-reconnect to last Bluetooth device
        this.attemptBluetoothReconnect();
    }

    // Generate a fun random rider name
    generateRiderName() {
        const adjectives = [
            'Speedy', 'Turbo', 'Lightning', 'Thunder', 'Cosmic', 'Blazing', 'Swift',
            'Mighty', 'Epic', 'Legendary', 'Rapid', 'Flying', 'Soaring', 'Crushing',
            'Wild', 'Fierce', 'Bold', 'Brave', 'Golden', 'Silver', 'Iron', 'Steel'
        ];

        const nouns = [
            'Cyclone', 'Tornado', 'Hurricane', 'Storm', 'Thunder', 'Lightning', 'Bolt',
            'Rider', 'Racer', 'Sprinter', 'Climber', 'Champion', 'Legend', 'Hero',
            'Falcon', 'Eagle', 'Hawk', 'Cheetah', 'Panther', 'Tiger', 'Lion', 'Dragon'
        ];

        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const number = Math.floor(Math.random() * 100);

        return `${adj} ${noun} ${number}`;
    }

    // Load saved rider name or generate new one
    loadRiderName() {
        let riderName = localStorage.getItem('riderName');

        if (!riderName) {
            riderName = this.generateRiderName();
            localStorage.setItem('riderName', riderName);
        }

        // Set in all input fields
        document.getElementById('quickJoinName').value = riderName;
        const hostNameInput = document.getElementById('hostNameInput');
        if (hostNameInput) hostNameInput.value = riderName;
        const joinNameInput = document.getElementById('joinNameInput');
        if (joinNameInput) joinNameInput.value = riderName;
    }

    // Save rider name when changed
    saveRiderName(name) {
        if (name && name.trim()) {
            localStorage.setItem('riderName', name.trim());
        }
    }

    // Auto-reconnect to last Bluetooth device
    async attemptBluetoothReconnect() {
        const lastDevice = this.ftms.getLastDevice();
        if (!lastDevice) {
            return;
        }

        // Check if bluetooth.getDevices() is available
        if (!navigator.bluetooth.getDevices) {
            this.log('Auto-reconnect not supported in this browser', 'info');
            return;
        }

        this.log(`Found previously connected device: ${lastDevice.name}`, 'info');

        // Add small delay to let page fully load
        setTimeout(async () => {
            const connected = await this.ftms.reconnectToLastDevice();
            if (connected) {
                if (window.Alpine) {
                    Alpine.store('app').setConnected(true, this.ftms.device?.name);
                }
                this.startMetricsBroadcast();
                this.updateQuickControlAvailability();
            }
        }, 1000);
    }

    async attemptSessionRestore() {
        const result = await this.sessionManager.restoreSession();
        if (result) {
            this.log('Session restored successfully!', 'success');

            // Update new UI (riders panel)
            this.updateSessionUI(result.sessionId, this.sessionManager.isHost);

            // Update old session tab UI
            document.getElementById('sessionNotConnected').style.display = 'none';
            document.getElementById('sessionConnected').style.display = 'block';
            document.getElementById('sessionCodeDisplay').textContent = result.sessionId;

            // Set FTP input
            document.getElementById('sessionFtpInput').value = window.workoutDesigner.ftp;

            setTimeout(() => lucide.createIcons(), 0);
        }
    }

    switchTab(tab) {
        // Update sidebar navigation links
        document.querySelectorAll('.sidebar nav a').forEach(link => link.classList.remove('active'));
        const navLink = document.getElementById(`nav-${tab}`);
        if (navLink) {
            navLink.classList.add('active');
        }

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`content-${tab}`).classList.add('active');

        this.currentTab = tab;

        if (tab === 'ride' && this.chart) {
            this.chart.resize();
        }

        // Refresh workout library when switching to workouts tab
        if (tab === 'workouts') {
            this.refreshWorkoutLibrary();
        }

        // Re-initialize Lucide icons after DOM update
        setTimeout(() => lucide.createIcons(), 0);
    }

    log(msg, type = 'info') {
        const logEl = document.getElementById('log');
        const line = document.createElement('div');
        line.className = type;
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
    }

    handleMetricsUpdate(metrics) {
        // Update Alpine store
        if (window.Alpine) {
            Alpine.store('app').updateMetrics({
                power: Math.max(0, metrics.power || 0),
                heartRate: metrics.hr || metrics.heartRate || 0,
                cadence: metrics.cadence || 0
            });
        }

        // Update chart
        const targetPower = this.chart.currentTargetPower;
        this.chart.addDataPoint(metrics.power, metrics.hr, targetPower);

        // Record data point if workout is active
        if (this.workoutRecorder.isRecording) {
            this.workoutRecorder.recordDataPoint(metrics.power, metrics.hr, metrics.cadence || 0);
        }

        // Broadcast to session if connected
        if (this.sessionManager && this.sessionManager.sessionId) {
            const progress = this.calculateWorkoutProgress();
            this.sessionManager.broadcastMetrics(metrics.power, metrics.cadence || 0, progress, metrics.hr);
        }
    }

    calculateWorkoutProgress() {
        if (!window.workoutDesigner.isRunning) return 0;

        const totalDuration = window.workoutDesigner.intervals.reduce((sum, i) => sum + i.duration, 0);
        const elapsed = (Date.now() - window.workoutDesigner.workoutStartTime) / 1000;
        return Math.min(1, Math.max(0, elapsed / totalDuration));
    }

    async connect() {
        // Set connecting state
        if (window.Alpine) {
            Alpine.store('app').setConnecting(true);
        }

        const connected = await this.ftms.connect();
        if (connected) {
            if (window.Alpine) {
                Alpine.store('app').setConnected(true, this.ftms.device?.name);
            }
            this.chart.clear();
            this.updateQuickControlAvailability();
        } else {
            if (window.Alpine) {
                Alpine.store('app').setConnecting(false);
            }
        }
    }

    disconnect() {
        this.ftms.disconnect();
        if (window.Alpine) {
            Alpine.store('app').setConnected(false);
        }
        this.updateQuickControlAvailability();

        if (this.rampInterval) {
            clearTimeout(this.rampInterval);
            this.rampInterval = null;
        }
        if (window.workoutDesigner.isRunning) {
            window.workoutDesigner.stopWorkout();
        }
    }

    handleWorkoutStart() {
        this.setQuickControlMode('intensity');
        this.handleIntensityScaleChange(window.workoutDesigner.intensityScale);

        setTimeout(() => {
            if (window.workoutDesigner && typeof window.workoutDesigner.applyCurrentIntervalTarget === 'function') {
                window.workoutDesigner.applyCurrentIntervalTarget(true);
            }
        }, 0);

        // Show active workout card when workout starts
        document.getElementById('activeWorkoutCard').style.display = 'block';
        document.getElementById('activeWorkoutCard').classList.remove('hidden');
        // Hide workout control card
        document.getElementById('workoutControlCard').style.display = 'none';
        document.getElementById('workoutControlCard').classList.add('hidden');
        // Hide workout summary if showing
        document.getElementById('workoutSummaryCard').classList.add('hidden');
        // Switch to ride tab
        this.switchTab('ride');

        // Start recording workout
        const workoutName = 'Indoor Cycling Workout';
        this.workoutRecorder.start(workoutName);
        this.log('Recording started', 'success');

        // Re-initialize icons
        setTimeout(() => lucide.createIcons(), 0);
    }

    handleWorkoutStop() {
        // Stop recording
        const dataPoints = this.workoutRecorder.stop();
        this.log(`Recording stopped: ${dataPoints} data points`, 'info');

        // Hide active workout card when workout stops
        document.getElementById('activeWorkoutCard').style.display = 'none';
        document.getElementById('activeWorkoutCard').classList.add('hidden');

        // Show workout summary if we have data
        if (dataPoints > 0) {
            this.showWorkoutSummary();
        } else {
            // Show workout control card again if we have intervals
            if (window.workoutDesigner.intervals.length > 0) {
                document.getElementById('workoutControlCard').style.display = 'block';
                document.getElementById('workoutControlCard').classList.remove('hidden');
            }
        }

        this.manualTargetPower = this.getCurrentTargetPower() || this.manualTargetPower;
        this.setQuickControlMode('power');

        // Re-initialize icons
        setTimeout(() => lucide.createIcons(), 0);
    }

    showWorkoutSummary() {
        const stats = this.workoutRecorder.getStats();

        // Update summary display
        document.getElementById('summaryDuration').textContent = this.workoutRecorder.formatDuration(stats.duration);
        document.getElementById('summaryAvgPower').textContent = `${stats.avgPower}W`;
        document.getElementById('summaryMaxPower').textContent = `${stats.maxPower}W`;
        document.getElementById('summaryAvgCadence').textContent = `${stats.avgCadence} rpm`;
        document.getElementById('summaryWork').textContent = `${stats.totalWork} kJ`;
        document.getElementById('summaryAvgHR').textContent = stats.avgHeartRate > 0 ? `${stats.avgHeartRate} bpm` : 'N/A';

        // Show summary card
        document.getElementById('workoutSummaryCard').style.display = 'block';

        // Re-initialize icons
        setTimeout(() => lucide.createIcons(), 0);
    }

    dismissWorkoutSummary() {
        document.getElementById('workoutSummaryCard').classList.add('hidden');

        // Show workout control card again if we have intervals
        if (window.workoutDesigner.intervals.length > 0) {
            document.getElementById('workoutControlCard').classList.remove('hidden');
        }

        // Clear recorded data
        this.workoutRecorder.clear();

        setTimeout(() => lucide.createIcons(), 0);
    }

    downloadWorkoutTCX() {
        try {
            const filename = this.workoutRecorder.downloadTCX();
            this.log(`Downloaded: ${filename}`, 'success');
        } catch (err) {
            alert('Failed to download TCX: ' + err.message);
        }
    }

    downloadWorkoutJSON() {
        try {
            const filename = this.workoutRecorder.downloadJSON();
            this.log(`Downloaded: ${filename}`, 'success');
        } catch (err) {
            alert('Failed to download JSON: ' + err.message);
        }
    }

    loadWorkoutForRide() {
        if (window.workoutDesigner.intervals.length === 0) {
            alert('Please design a workout first!');
            return;
        }
        // Show workout control card
        document.getElementById('workoutControlCard').style.display = 'block';
        document.getElementById('workoutControlCard').classList.remove('hidden');
        
        // Show host sync button if in session and is host
        this.updateWorkoutControlButtons();
        
        // Switch to ride tab
        this.switchTab('ride');
        
        setTimeout(() => lucide.createIcons(), 0);
    }

    updateWorkoutControlButtons() {
        const syncBtn = document.getElementById('startSyncedBtnSidebar');
        const normalBtn = document.getElementById('startWorkoutBtn');
        
        if (this.sessionManager && this.sessionManager.isConnected() && this.sessionManager.isHost) {
            // Show sync button for host, hide normal button
            if (syncBtn) syncBtn.style.display = 'block';
            if (normalBtn) normalBtn.style.display = 'none';
        } else {
            // Show normal button, hide sync button
            if (syncBtn) syncBtn.style.display = 'none';
            if (normalBtn) normalBtn.style.display = 'block';
        }
    }


    updateFTP() {
        const ftp = parseInt(document.getElementById('ftpInput').value);
        if (!isNaN(ftp) && ftp >= 50 && ftp <= 500) {
            window.workoutDesigner.setFTP(ftp);
            this.log(`FTP updated to ${ftp}W`, 'info');
        }
    }

    // Workout management
    saveWorkout() {
        window.workoutDesigner.saveWorkout();
    }

    loadWorkout() {
        window.workoutDesigner.showWorkoutManager();
    }

    exportWorkout() {
        window.workoutDesigner.exportWorkout();
    }

    importWorkout() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                window.workoutDesigner.importWorkout(file);
            }
        };
        input.click();
    }

    initQuickControl() {
        const slider = document.getElementById('powerSlider');
        const display = document.getElementById('powerDisplay');
        const label = document.getElementById('quickControlLabel');
        const button = document.getElementById('setPowerBtn');

        this.quickControlElements = {
            slider,
            display,
            label,
            button,
            buttonText: button ? button.querySelector('span') : null
        };

        if (slider) {
            const defaultValue = Number(slider.value);
            if (Number.isFinite(defaultValue)) {
                this.manualTargetPower = Math.max(0, Math.round(defaultValue));
            }
        }

        this.setQuickControlMode(this.quickControlMode || 'power');
        this.refreshQuickControlDisplay();
        this.updateQuickControlAvailability();
        this.handleIntensityScaleChange(window.workoutDesigner.intensityScale);
    }

    updateQuickControlAvailability() {
        const button = this.quickControlElements?.button;
        if (!button) return;
        if (this.quickControlMode === 'intensity') {
            button.disabled = true;
            button.title = 'Intensity adjusts automatically while a workout is running.';
            return;
        }

        const connected = this.ftms.isConnected();
        button.disabled = !connected;
        button.title = connected ? '' : 'Connect to your trainer to send a power command.';
    }

    setQuickControlMode(mode) {
        this.quickControlMode = mode;

        const elements = this.quickControlElements || {};
        const slider = elements.slider;
        const label = elements.label;
        const buttonText = elements.buttonText;

        if (!slider) {
            return;
        }

        if (mode === 'intensity') {
            const percentRaw = this.pendingIntensityPercent || Math.round(window.workoutDesigner.intensityScale * 100);
            const percent = Math.max(50, Math.min(150, Number.isFinite(percentRaw) ? percentRaw : 100));
            slider.min = '50';
            slider.max = '150';
            slider.step = '1';
            slider.value = String(percent);
            this.pendingIntensityPercent = percent;
            if (label) label.textContent = 'Workout Intensity';
            if (buttonText) buttonText.textContent = 'Intensity Auto-Adjusts';
        } else {
            const manualRaw = Number.isFinite(this.manualTargetPower) ? this.manualTargetPower : 100;
            const manual = Math.max(0, Math.round(manualRaw));
            slider.min = '0';
            slider.max = '500';
            slider.step = '1';
            slider.value = String(manual);
            if (label) label.textContent = 'Target Power';
            if (buttonText) buttonText.textContent = 'Set Power';
        }

        this.refreshQuickControlDisplay();
        this.updateQuickControlAvailability();
    }

    refreshQuickControlDisplay() {
        const slider = this.quickControlElements?.slider;
        if (!slider) return;

        if (this.quickControlMode === 'intensity') {
            const percent = Math.round(Number(slider.value));
            this.updateQuickControlDisplayForIntensity(percent);
        } else {
            const power = Math.round(Number(slider.value));
            this.updateQuickControlDisplayForPower(power);
        }
    }

    updateQuickControlDisplayForPower(power) {
        const display = this.quickControlElements?.display;
        if (!display) return;

        const normalized = Number.isFinite(power) ? Math.max(0, Math.round(power)) : (this.manualTargetPower || 0);
        display.textContent = `${normalized}W`;
    }

    updateQuickControlDisplayForIntensity(percent, targetPower) {
        const display = this.quickControlElements?.display;
        if (!display) return;

        const normalizedPercent = Number.isFinite(percent) ? Math.max(50, Math.min(150, Math.round(percent))) : (this.pendingIntensityPercent || 100);
        const activePercent = Math.max(1, Math.round(this.activeIntensityPercent || normalizedPercent));
        const baselineTarget = Number.isFinite(targetPower) ? Math.round(targetPower) : this.getCurrentTargetPower();

        if (Number.isFinite(baselineTarget) && baselineTarget > 0) {
            if (normalizedPercent === activePercent) {
                display.textContent = `${normalizedPercent}% (${baselineTarget}W)`;
            } else {
                const projected = Math.round(baselineTarget * (normalizedPercent / activePercent));
                display.textContent = `${normalizedPercent}% (${baselineTarget}W → ${projected}W)`;
            }
        } else {
            display.textContent = `${normalizedPercent}%`;
        }
    }

    handleQuickControlInput() {
        const slider = this.quickControlElements?.slider;
        if (!slider) return;

        if (this.quickControlMode === 'intensity') {
            const percent = Math.max(50, Math.min(150, Math.round(Number(slider.value))));
            this.pendingIntensityPercent = percent;
            slider.value = String(percent);
            this.updateQuickControlDisplayForIntensity(percent);
        } else {
            const power = Math.round(Number(slider.value));
            this.manualTargetPower = Math.max(0, power);
            this.updateQuickControlDisplayForPower(power);
        }
    }

    handleQuickControlCommit() {
        const slider = this.quickControlElements?.slider;
        if (!slider) return;

        if (this.quickControlMode === 'intensity') {
            const percent = Math.max(50, Math.min(150, Math.round(Number(slider.value))));
            this.pendingIntensityPercent = percent;
            slider.value = String(percent);
            this.updateQuickControlDisplayForIntensity(percent);

            if (percent === this.activeIntensityPercent) {
                return;
            }

            const scale = percent / 100;
            if (window.workoutDesigner && typeof window.workoutDesigner.setIntensityScale === 'function') {
                this.log(`Adjusting workout intensity to ${percent}%`, 'info');
                window.workoutDesigner.setIntensityScale(scale);
            }
        }
    }

    async handleQuickControlAction() {
        const slider = this.quickControlElements?.slider;
        if (!slider) return;

        if (this.quickControlMode === 'intensity') {
            const percent = Math.max(50, Math.min(150, Math.round(Number(slider.value))));
            const scale = percent / 100;
            this.pendingIntensityPercent = percent;
            this.log(`Adjusting workout intensity to ${percent}%`, 'info');
            window.workoutDesigner.setIntensityScale(scale);
            this.updateQuickControlDisplayForIntensity(percent);
            return;
        }

        const power = Math.max(0, Math.round(Number(slider.value)));
        this.manualTargetPower = power;
        await this.applyTargetPower(power);
        this.updateQuickControlDisplayForPower(power);
    }

    async applyTargetPower(power) {
        if (!this.ftms.isConnected()) {
            this.log('Please connect to your trainer first', 'warning');
            return;
        }

        this.log(`Setting power to ${power}W...`, 'info');

        const success = await this.ftms.setTargetPower(power);
        if (success) {
            this.updateTargetPowerUI(power);
        }
    }

    updateTargetPowerUI(power) {
        const normalized = Math.max(0, Math.round(Number(power) || 0));
        const valueEl = document.getElementById('targetPowerValue');
        if (valueEl) {
            valueEl.textContent = normalized;
        }

        if (this.chart) {
            this.chart.setTargetPower(normalized);
        }

        if (window.Alpine && typeof Alpine.store === 'function') {
            try {
                Alpine.store('app').setTargetPower(normalized);
            } catch (_) {
                // Ignore Alpine update failures
            }
        }

        if (this.quickControlMode === 'intensity') {
            this.updateQuickControlDisplayForIntensity(this.pendingIntensityPercent, normalized);
        } else {
            const slider = this.quickControlElements?.slider;
            if (slider) {
                slider.value = String(normalized);
            }
            this.manualTargetPower = normalized;
            this.updateQuickControlDisplayForPower(normalized);
        }
    }

    handleIntensityScaleChange(scale) {
        const numericScale = Number(scale);
        if (!Number.isFinite(numericScale)) return;

        const clampedPercent = Math.max(50, Math.min(150, Math.round(numericScale * 100)));
        this.activeIntensityPercent = clampedPercent;
        this.pendingIntensityPercent = clampedPercent;

        if (this.quickControlMode === 'intensity') {
            const slider = this.quickControlElements?.slider;
            if (slider) {
                slider.value = String(clampedPercent);
            }
            this.updateQuickControlDisplayForIntensity(clampedPercent);
        }
    }

    getCurrentTargetPower() {
        if (window.Alpine && typeof Alpine.store === 'function') {
            try {
                const possible = Alpine.store('app').ui?.targetPower;
                const numeric = Number(possible);
                if (Number.isFinite(numeric) && numeric > 0) {
                    return Math.round(numeric);
                }
            } catch (_) {
                // Ignore Alpine access failures
            }
        }

        const textValue = document.getElementById('targetPowerValue')?.textContent;
        if (textValue) {
            const parsed = parseInt(textValue, 10);
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }

        if (this.chart && Number.isFinite(this.chart.currentTargetPower) && this.chart.currentTargetPower > 0) {
            return Math.round(this.chart.currentTargetPower);
        }

        return null;
    }

    refreshWorkoutLibrary() {
        const library = document.getElementById('workoutLibrary');
        const workouts = window.workoutDesigner.getStoredWorkouts();
        const names = Object.keys(workouts);

        if (names.length === 0) {
            library.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 4rem 2rem; color: var(--text-muted);">
                    <i data-lucide="inbox" style="width: 48px; height: 48px; margin: 0 auto 1rem; opacity: 0.5;"></i>
                    <p style="font-size: 1rem;">No saved workouts yet</p>
                    <p style="font-size: 0.875rem; margin-top: 0.5rem;">Design a workout and save it, or import a workout file</p>
                </div>
            `;
            setTimeout(() => lucide.createIcons(), 0);
            return;
        }

        library.innerHTML = names.map(name => {
            const workout = workouts[name];
            return this.createWorkoutCard(name, workout);
        }).join('');

        setTimeout(() => {
            lucide.createIcons();
            WorkoutPreview.refreshAllPreviews();
        }, 0);
    }

    createWorkoutCard(name, workout) {
        const totalDuration = workout.intervals.reduce((sum, i) => sum + i.duration, 0);
        const totalWork = workout.intervals.reduce((sum, i) => {
            // Calculate power based on powerType
            const powerType = i.powerType || 'relative';
            let power;
            
            if (powerType === 'absolute') {
                power = i.power || 0;
            } else {
                const percentage = i.percentage || 100;
                power = Math.round((workout.ftp || 200) * (percentage / 100));
            }
            
            return sum + (power * i.duration);
        }, 0) / 1000;
        const avgPower = totalDuration > 0 ? Math.round(totalWork * 1000 / totalDuration) : 0;

        const formatDuration = (seconds) => {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        const created = workout.created ? new Date(workout.created).toLocaleDateString() : 'Unknown';
        
        // Get description if available
        const description = workout.description ? `<div class="workout-card-description">${workout.description}</div>` : '';

        return `
            <div class="workout-card" onclick="app.loadWorkoutFromLibrary('${name}')">
                <div class="workout-card-header">
                    <div>
                        <div class="workout-card-title">${name}</div>
                        ${description}
                        <div class="workout-card-meta">Created: ${created}</div>
                    </div>
                    <div class="workout-card-actions">
                        <button onclick="event.stopPropagation(); app.deleteWorkoutFromLibrary('${name}')" class="btn btn-sm btn-ghost" title="Delete">
                            <i data-lucide="trash-2"></i>
                        </button>
                        <button onclick="event.stopPropagation(); app.exportWorkoutByName('${name}')" class="btn btn-sm" title="Export">
                            <i data-lucide="download"></i>
                        </button>
                    </div>
                </div>
                <canvas id="preview-${name.replace(/\s+/g, '-')}" class="workout-preview"></canvas>
                <div class="workout-card-stats">
                    <div><i data-lucide="clock"></i> ${formatDuration(totalDuration)}</div>
                    <div><i data-lucide="gauge"></i> ${avgPower}W avg</div>
                    <div><i data-lucide="flame"></i> ${totalWork.toFixed(1)}kJ</div>
                </div>
            </div>
        `;
    }

    loadWorkoutFromLibrary(name) {
        window.workoutDesigner.loadWorkout(name);
        // Show workout control card when loading from library
        document.getElementById('workoutControlCard').classList.remove('hidden');
        this.switchTab('design');
    }

    deleteWorkoutFromLibrary(name) {
        window.workoutDesigner.deleteWorkout(name);
        this.refreshWorkoutLibrary();
    }

    exportWorkoutByName(name) {
        const workouts = window.workoutDesigner.getStoredWorkouts();
        const workout = workouts[name];
        if (!workout) return;

        const dataStr = JSON.stringify(workout, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name.replace(/\s+/g, '_')}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    // Session Management
    async createSession() {
        console.log('createSession called');
        const userName = document.getElementById('hostNameInput').value.trim() || 'Rider';
        console.log('User name:', userName);

        try {
            console.log('Calling sessionManager.createSession...');
            const result = await this.sessionManager.createSession(userName);
            console.log('Session created successfully:', result);
            this.log(`Session created: ${result.sessionId}`, 'success');

            // Update UI
            document.getElementById('sessionNotConnected').style.display = 'none';
            document.getElementById('sessionConnected').style.display = 'block';
            document.getElementById('sessionCodeDisplay').textContent = result.sessionId;

            // Set FTP input to current workout designer FTP
            document.getElementById('sessionFtpInput').value = window.workoutDesigner.ftp;
            this.sessionManager.updateFTP(window.workoutDesigner.ftp);

            // Setup race track
            if (window.workoutDesigner.intervals.length > 0) {
                this.raceTrack.setWorkout(window.workoutDesigner.intervals, window.workoutDesigner.ftp);
            }

            setTimeout(() => lucide.createIcons(), 0);
        } catch (err) {
            console.error('createSession error:', err);
            alert('Failed to create session: ' + err.message);
        }
    }

    async joinSession() {
        const userName = document.getElementById('joinNameInput').value.trim() || 'Rider';
        const sessionCode = document.getElementById('sessionCodeInput').value.trim();

        if (!sessionCode) {
            alert('Please enter a session code');
            return;
        }

        try {
            const result = await this.sessionManager.joinSession(sessionCode, userName);
            this.log(`Joined session: ${result.sessionId}`, 'success');

            // Update UI
            document.getElementById('sessionNotConnected').style.display = 'none';
            document.getElementById('sessionConnected').style.display = 'block';
            document.getElementById('sessionCodeDisplay').textContent = result.sessionId;

            // Set FTP input to current workout designer FTP
            document.getElementById('sessionFtpInput').value = window.workoutDesigner.ftp;
            this.sessionManager.updateFTP(window.workoutDesigner.ftp);

            setTimeout(() => lucide.createIcons(), 0);
        } catch (err) {
            alert('Failed to join session: ' + err.message);
            console.error(err);
        }
    }

    disconnectSession() {
        if (confirm('Leave this session?')) {
            this.sessionManager.disconnect();
            this.log('Left session', 'warning');

            // Update Alpine store
            if (window.Alpine) {
                Alpine.store('app').clearSession();
            }

            // Update old session tab UI
            document.getElementById('sessionNotConnected').style.display = 'block';
            document.getElementById('sessionConnected').style.display = 'none';

            // Clear inputs
            document.getElementById('quickJoinSessionCode').value = '';

            // Clear race track
            this.raceTrack.clear();
            
            // Update workout control buttons (hide sync, show normal)
            this.updateWorkoutControlButtons();
            
            // Hide workout participants section
            const section = document.getElementById('workoutParticipantsSection');
            if (section) section.style.display = 'none';

            setTimeout(() => lucide.createIcons(), 0);
        }
    }

    async quickCreateSession() {
        const userName = document.getElementById('quickJoinName').value.trim() || this.generateRiderName();
        // Save the name for next time
        this.saveRiderName(userName);

        try {
            const result = await this.sessionManager.createSession(userName);
            this.log(`Session created: ${result.sessionId}`, 'success');
            this.updateSessionUI(result.sessionId, true);

            // Close the popover by setting aria-hidden
            const popoverContent = document.getElementById('session-popover-content');
            const popoverTrigger = document.getElementById('session-popover-trigger');
            popoverContent.setAttribute('aria-hidden', 'true');
            popoverTrigger.setAttribute('aria-expanded', 'false');
        } catch (err) {
            console.error('quickCreateSession error:', err);
            alert('Failed to create session: ' + err.message);
        }
    }

    async quickJoinSession() {
        const userName = document.getElementById('quickJoinName').value.trim() || this.generateRiderName();
        const sessionCode = document.getElementById('quickJoinSessionCode').value.trim();

        // Save the name for next time
        this.saveRiderName(userName);

        if (!sessionCode) {
            alert('Please enter a session code');
            return;
        }

        try {
            const result = await this.sessionManager.joinSession(sessionCode, userName);
            this.log(`Joined session: ${result.sessionId}`, 'success');
            this.updateSessionUI(result.sessionId, false);

            // Close the popover by setting aria-hidden
            const popoverContent = document.getElementById('session-popover-content');
            const popoverTrigger = document.getElementById('session-popover-trigger');
            popoverContent.setAttribute('aria-hidden', 'true');
            popoverTrigger.setAttribute('aria-expanded', 'false');
        } catch (err) {
            alert('Failed to join session: ' + err.message);
            console.error(err);
        }
    }

    updateSessionUI(sessionId, isHost) {
        // Update Alpine store
        if (window.Alpine) {
            Alpine.store('app').setSession(sessionId, isHost, this.sessionManager.userName);
        }

        // Update old session tab UI as well
        document.getElementById('sessionNotConnected').style.display = 'none';
        document.getElementById('sessionConnected').style.display = 'block';
        document.getElementById('sessionCodeDisplay').textContent = sessionId;

        // Set FTP
        const ftp = window.workoutDesigner.ftp;
        document.getElementById('sessionFtpInput').value = ftp;
        this.sessionManager.updateFTP(ftp);

        // Setup race track
        if (window.workoutDesigner.intervals.length > 0) {
            this.raceTrack.setWorkout(window.workoutDesigner.intervals, ftp);
        }
        
        // Update workout control buttons
        this.updateWorkoutControlButtons();

        setTimeout(() => lucide.createIcons(), 100);
    }

    copySessionInfo() {
        const shareInfo = this.sessionManager.getShareInfo();
        if (!shareInfo) return;

        const text = `Join my Zwift Hub workout!\n\nSession Code:\n${shareInfo.sessionId}\n\nPaste this code in the Session tab to join!`;

        navigator.clipboard.writeText(text).then(() => {
            this.log('Session code copied to clipboard!', 'success');
        }).catch(err => {
            alert('Failed to copy: ' + err.message);
        });
    }

    handleParticipantUpdate(participants) {
        const myId = this.sessionManager?.myId;
        const normalized = (participants || []).map((p) => ({
            ...p,
            isSelf: myId ? p.id === myId : Boolean(p.isSelf)
        }));

        // Update Alpine store - this will reactively update all UI elements
        if (window.Alpine) {
            Alpine.store('app').updateParticipants(normalized);
        }

        // Update icons after Alpine renders
        setTimeout(() => lucide.createIcons(), 0);

        // Update race track
        this.raceTrack.setParticipants(normalized);
        this.raceTrack.draw();

        // Update workout control buttons
        this.updateWorkoutControlButtons();
    }

    handleWorkoutReceived(workout) {
        if (!workout) return;

        this.log('Received workout from host!', 'success');

        // Load the workout intervals into the designer
        window.workoutDesigner.intervals = workout.intervals.map(i => ({
            ...i,
            id: Date.now() + Math.random()
        }));

        // Don't override local FTP - each participant uses their own
        window.workoutDesigner.render();
        window.workoutDesigner.updateWorkoutInfo();

        // Setup race track with received workout
        this.raceTrack.setWorkout(workout.intervals, window.workoutDesigner.ftp);

        // Show notification
        alert(`Workout received: ${workout.name || 'Unnamed Workout'}\n\nThe workout has been loaded and will scale to your FTP (${window.workoutDesigner.ftp}W).\n\nYou can adjust your FTP in the "My FTP" section above.`);
    }

    handleSessionStart(startTime) {
        const delay = startTime - Date.now();
        const seconds = Math.ceil(delay / 1000);

        this.log(`Workout starting in ${seconds} seconds...`, 'info');

        // Show countdown
        const countdownEl = document.getElementById('countdownDisplay');
        const countdownNum = document.getElementById('countdownNumber');

        if (countdownEl && countdownNum) {
            countdownEl.style.display = 'block';

            let remaining = seconds;
            countdownNum.textContent = remaining;
            const countdownInterval = setInterval(() => {
                remaining--;
                countdownNum.textContent = remaining;

                if (remaining <= 0) {
                    clearInterval(countdownInterval);
                    countdownEl.style.display = 'none';

                    // Start workout
                    window.workoutDesigner.startWorkout();

                    // Update host controls
                    document.getElementById('startSyncedBtn').style.display = 'none';
                    document.getElementById('endSyncedBtn').classList.remove('hidden');
                }
            }, 1000);
        }
    }

    handleSessionEnd() {
        this.log('Host ended the workout', 'warning');
        if (window.workoutDesigner.isRunning) {
            window.workoutDesigner.stopWorkout();
        }

        // Reset host controls
        document.getElementById('startSyncedBtn').style.display = 'block';
        document.getElementById('endSyncedBtn').classList.add('hidden');
    }

    startSyncedWorkout() {
        if (window.workoutDesigner.intervals.length === 0) {
            alert('Please load a workout first!');
            return;
        }

        if (!this.ftms.isConnected()) {
            alert('Please connect to your trainer first!');
            return;
        }

        // Share workout with all participants
        const workout = {
            name: 'Shared Workout',
            intervals: window.workoutDesigner.intervals,
            ftp: window.workoutDesigner.ftp // Host's FTP as reference
        };
        this.sessionManager.shareWorkout(workout);

        // Setup race track with workout
        this.raceTrack.setWorkout(window.workoutDesigner.intervals, window.workoutDesigner.ftp);

        // Start synchronized countdown
        this.sessionManager.startSynchronizedWorkout(5);
    }

    updateSessionFTP() {
        const ftp = parseInt(document.getElementById('sessionFtpInput').value);
        if (isNaN(ftp) || ftp < 50 || ftp > 500) {
            alert('Please enter a valid FTP between 50 and 500');
            return;
        }

        // Update local FTP
        window.workoutDesigner.setFTP(ftp);

        // Broadcast to all session participants
        if (this.sessionManager && this.sessionManager.sessionId) {
            this.sessionManager.updateFTP(ftp);
            this.log(`FTP updated to ${ftp}W and shared with group`, 'success');
        }

        // Update race track if workout is loaded
        if (window.workoutDesigner.intervals.length > 0) {
            this.raceTrack.setWorkout(window.workoutDesigner.intervals, ftp);
        }
    }

    endSyncedWorkout() {
        this.sessionManager.endWorkout();
        if (window.workoutDesigner.isRunning) {
            window.workoutDesigner.stopWorkout();
        }

        // Reset host controls
        document.getElementById('startSyncedBtn').style.display = 'block';
        document.getElementById('endSyncedBtn').classList.add('hidden');
    }

    openMeetLink() {
        const link = document.getElementById('meetLinkInput').value.trim();
        if (!link) {
            alert('Please enter a Google Meet link');
            return;
        }

        window.open(link, '_blank');
        this.log('Opened Google Meet', 'info');
    }
}

// Initialize app when page loads
const app = new App();
