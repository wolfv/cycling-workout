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

        // Load workout library
        this.refreshWorkoutLibrary();
    }

    switchTab(tab) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');

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
        document.getElementById('hrValue').textContent = metrics.hr;
        document.getElementById('cadenceValue').textContent = metrics.cadence || 0;
        document.getElementById('statusValue').textContent = '✓';

        // Update chart
        const targetPower = this.chart.currentTargetPower;
        this.chart.addDataPoint(metrics.power, metrics.hr, targetPower);
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
        document.getElementById('activeWorkoutCard').style.display = 'block';
        // Hide workout control card
        document.getElementById('workoutControlCard').style.display = 'none';
        // Switch to ride tab
        this.switchTab('ride');
        // Re-initialize icons
        setTimeout(() => lucide.createIcons(), 0);
    }

    handleWorkoutStop() {
        // Hide active workout card when workout stops
        document.getElementById('activeWorkoutCard').style.display = 'none';
        // Show workout control card again if we have intervals
        if (window.workoutDesigner.intervals.length > 0) {
            document.getElementById('workoutControlCard').style.display = 'block';
        }
        // Re-initialize icons
        setTimeout(() => lucide.createIcons(), 0);
    }

    loadWorkoutForRide() {
        if (window.workoutDesigner.intervals.length === 0) {
            alert('Please design a workout first!');
            return;
        }
        // Show workout control card
        document.getElementById('workoutControlCard').style.display = 'block';
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
        const power = parseInt(document.getElementById('powerInput').value);
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
        document.getElementById('workoutControlCard').style.display = 'block';
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
}

// Initialize app when page loads
const app = new App();
