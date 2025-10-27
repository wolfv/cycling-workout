// Main Application
class App {
    constructor() {
        this.ftms = new FTMSController();
        this.chart = new LiveChart('liveChart', 120); // 2 minutes of data
        this.currentTab = 'ride';

        // Setup FTMS callbacks
        this.ftms.onLog = (msg, type) => this.log(msg, type);
        this.ftms.onMetricsUpdate = (metrics) => this.handleMetricsUpdate(metrics);

        // Initialize workout designer
        window.workoutDesigner = new WorkoutDesigner(this.ftms);
        window.workoutDesigner.onTargetPowerChange = (power) => {
            document.getElementById('targetPowerValue').textContent = power;
            this.chart.setTargetPower(power);
        };
        window.workoutDesigner.onWorkoutStart = () => this.handleWorkoutStart();
        window.workoutDesigner.onWorkoutStop = () => this.handleWorkoutStop();

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
                this.updateConnectionStatus(true);
                this.startMetricsBroadcast();
            }
        }, 1000);
    }

    async attemptSessionRestore() {
        const result = await this.sessionManager.restoreSession();
        if (result) {
            this.log('Session restored successfully!', 'success');

            // Update UI based on host/participant
            document.getElementById('sessionNotConnected').style.display = 'none';
            document.getElementById('sessionConnected').style.display = 'block';
            document.getElementById('sessionCodeDisplay').textContent = result.sessionId;

            if (this.sessionManager.isHost) {
                document.getElementById('sessionHostControls').style.display = 'block';
            }

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
        // Update UI
        document.getElementById('powerValue').textContent = Math.max(0, metrics.power);

        // Update HR with zone color
        const hrElement = document.getElementById('hrValue');
        hrElement.textContent = metrics.hr || '--';
        if (metrics.hr > 0) {
            const hrColor = HRZones.getHRColor(metrics.hr);
            hrElement.style.color = hrColor;
        } else {
            hrElement.style.color = '';
        }

        document.getElementById('cadenceValue').textContent = metrics.cadence || 0;
        document.getElementById('statusValue').textContent = '✓';

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
        const connected = await this.ftms.connect();
        if (connected) {
            this.updateConnectionUI(true);
            this.chart.clear();
        }
    }

    disconnect() {
        this.ftms.disconnect();
        this.updateConnectionUI(false);
        if (this.rampInterval) {
            clearTimeout(this.rampInterval);
            this.rampInterval = null;
        }
        if (window.workoutDesigner.isRunning) {
            window.workoutDesigner.stopWorkout();
        }
    }

    updateConnectionUI(connected) {
        document.getElementById('connectBtn').disabled = connected;
        document.getElementById('disconnectBtn').disabled = !connected;
        document.getElementById('setPowerBtn').disabled = !connected;
        document.getElementById('statusValue').textContent = connected ? '✓' : '✗';
    }

    handleWorkoutStart() {
        // Show active workout card when workout starts
        document.getElementById('activeWorkoutCard').classList.remove('hidden');
        // Hide workout control card
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
        document.getElementById('activeWorkoutCard').classList.add('hidden');

        // Show workout summary if we have data
        if (dataPoints > 0) {
            this.showWorkoutSummary();
        } else {
            // Show workout control card again if we have intervals
            if (window.workoutDesigner.intervals.length > 0) {
                document.getElementById('workoutControlCard').classList.remove('hidden');
            }
        }

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
        document.getElementById('workoutControlCard').classList.remove('hidden');
        // Switch to ride tab
        this.switchTab('ride');
        this.log('Workout loaded! Connect your trainer and click "Start Workout" in the sidebar.', 'success');
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

    async setPowerCommand() {
        const power = parseInt(document.getElementById('powerSlider').value);
        this.log(`Setting power to ${power}W...`, 'info');

        const success = await this.ftms.setTargetPower(power);
        if (success) {
            document.getElementById('targetPowerValue').textContent = power;
            this.chart.setTargetPower(power);
        }
    }

    updatePowerDisplay() {
        const power = document.getElementById('powerSlider').value;
        document.getElementById('powerDisplay').textContent = `${power}W`;
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
            const power = Math.round((workout.ftp || 200) * (i.percentage / 100));
            return sum + (power * i.duration);
        }, 0) / 1000;
        const avgPower = totalDuration > 0 ? Math.round(totalWork * 1000 / totalDuration) : 0;

        const formatDuration = (seconds) => {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        const created = workout.created ? new Date(workout.created).toLocaleDateString() : 'Unknown';

        return `
            <div class="workout-card" onclick="app.loadWorkoutFromLibrary('${name}')">
                <div class="workout-card-header">
                    <div>
                        <div class="workout-card-title">${name}</div>
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
            document.getElementById('sessionHostControls').style.display = 'block';

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

            // Update main UI (using Tailwind classes)
            document.getElementById('sessionPopoverTrigger').classList.remove('hidden');
            document.getElementById('ridersCard').classList.add('hidden');
            document.getElementById('quickStartSyncedBtn').classList.add('hidden');

            // Update old session tab UI
            document.getElementById('sessionNotConnected').style.display = 'block';
            document.getElementById('sessionConnected').style.display = 'none';
            document.getElementById('sessionHostControls').style.display = 'none';
            document.getElementById('participantsList').innerHTML = '';

            // Clear inputs
            document.getElementById('quickJoinSessionCode').value = '';

            // Clear race track
            this.raceTrack.clear();

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
        // Hide popover trigger
        document.getElementById('sessionPopoverTrigger').classList.add('hidden');

        // Show riders card with session info
        document.getElementById('ridersCard').classList.remove('hidden');
        document.getElementById('sessionCodeSidebar').textContent = sessionId;

        // Show host controls if host
        if (isHost) {
            document.getElementById('quickStartSyncedBtn').classList.remove('hidden');
        }

        // Update old session tab UI as well
        document.getElementById('sessionNotConnected').style.display = 'none';
        document.getElementById('sessionConnected').style.display = 'block';
        document.getElementById('sessionCodeDisplay').textContent = sessionId;
        if (isHost) {
            document.getElementById('sessionHostControls').style.display = 'block';
        }

        // Set FTP
        const ftp = window.workoutDesigner.ftp;
        document.getElementById('sessionFtpInput').value = ftp;
        this.sessionManager.updateFTP(ftp);

        // Setup race track
        if (window.workoutDesigner.intervals.length > 0) {
            this.raceTrack.setWorkout(window.workoutDesigner.intervals, ftp);
        }

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
        // Update participants list in Session tab
        const listEl = document.getElementById('participantsList');
        if (listEl) {
            if (participants.length === 0) {
                listEl.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 2rem;">No participants yet</div>';
            } else {
                listEl.innerHTML = participants.map(p => {
                    const hrColor = p.heartRate > 0 ? HRZones.getHRColor(p.heartRate) : '#666';
                    return `
                    <div class="participant-card ${p.isHost ? 'host' : ''}">
                        <div class="participant-info">
                            <div class="participant-name">
                                ${p.name}
                                ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
                                <span class="ftp-badge">${p.ftp}W FTP</span>
                            </div>
                            <div class="participant-metrics">
                                <span><i data-lucide="zap"></i> ${p.power}W</span>
                                <span><i data-lucide="gauge"></i> ${p.cadence} rpm</span>
                                <span><i data-lucide="heart"></i> <span style="color: ${hrColor}">${p.heartRate || '--'}</span></span>
                            </div>
                        </div>
                        <div class="participant-progress">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${p.progress * 100}%"></div>
                            </div>
                        </div>
                    </div>
                `;}).join('');
            }
        }

        // Update compact participants list in Active Workout card
        const workoutListEl = document.getElementById('workoutParticipantsList');
        const workoutSectionEl = document.getElementById('workoutParticipantsSection');

        if (workoutListEl && workoutSectionEl) {
            if (participants.length > 0) {
                workoutSectionEl.style.display = 'block';
                workoutListEl.innerHTML = participants.map(p => {
                    const hrColor = p.heartRate > 0 ? HRZones.getHRColor(p.heartRate) : '#666';
                    return `
                    <div class="workout-participant-compact ${p.isHost ? 'host' : ''}">
                        <div class="workout-participant-name">
                            ${p.name}
                            ${p.isHost ? '<span class="host-badge-mini">HOST</span>' : ''}
                        </div>
                        <div class="workout-participant-stats">
                            <span class="stat-compact"><i data-lucide="zap"></i>${p.power}W</span>
                            <span class="stat-compact"><i data-lucide="gauge"></i>${p.cadence}rpm</span>
                            <span class="stat-compact"><i data-lucide="heart"></i><span style="color: ${hrColor}">${p.heartRate || '--'}</span></span>
                            <span class="stat-compact ftp-mini">${p.ftp}W FTP</span>
                        </div>
                    </div>
                `;}).join('');
            } else {
                workoutSectionEl.style.display = 'none';
            }
        }

        // Update sidebar riders list and count
        const sidebarListEl = document.getElementById('ridersListSidebar');
        const riderCountEl = document.getElementById('riderCount');

        if (riderCountEl) {
            riderCountEl.textContent = participants.length;
        }

        if (sidebarListEl) {
            if (participants.length === 0) {
                sidebarListEl.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1rem;">No riders</div>';
            } else {
                sidebarListEl.innerHTML = participants.map(p => {
                    const hrColor = p.heartRate > 0 ? HRZones.getHRColor(p.heartRate) : '#666';
                    return `
                    <div style="padding: 0.75rem; border-bottom: 1px solid var(--border);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                            <div style="font-weight: 500;">
                                ${p.name}
                                ${p.isHost ? '<span class="badge-secondary" style="font-size: 0.7rem; margin-left: 0.25rem;">HOST</span>' : ''}
                            </div>
                            <span style="font-size: 0.75rem; color: var(--muted-foreground);">${p.ftp}W</span>
                        </div>
                        <div style="display: flex; gap: 0.75rem; font-size: 0.875rem; color: var(--muted-foreground);">
                            <span><i data-lucide="zap" style="width: 14px; height: 14px;"></i> ${p.power}W</span>
                            <span><i data-lucide="gauge" style="width: 14px; height: 14px;"></i> ${p.cadence}</span>
                            <span><i data-lucide="heart" style="width: 14px; height: 14px;"></i> <span style="color: ${hrColor}">${p.heartRate || '--'}</span></span>
                        </div>
                    </div>
                    `;
                }).join('');
            }
        }

        setTimeout(() => lucide.createIcons(), 0);

        // Update race track
        this.raceTrack.setParticipants(participants);
        this.raceTrack.draw();
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
