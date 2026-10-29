// Workout Designer with drag-and-drop functionality
class WorkoutDesigner {
    constructor(ftmsController) {
        this.ftms = ftmsController;
        this.intervals = [];
        this.name = 'Custom workout';
        this.description = '';
        this.selectedInterval = null;
        this.draggedInterval = null;
        this.isRunning = false;
        this.currentIntervalIndex = -1;
        this.workoutTimer = null;
        this.workoutStartTime = null;
        this.intervalStartTime = null;
        this.progressUpdateInterval = null;
        this.onTargetPowerChange = null;
        this.onWorkoutStart = null;
        this.onWorkoutStop = null;
        this.onIntensityScaleChange = null;
        this.ftp = 200; // Default FTP
        this.intensityScale = this.loadIntensityScale();

        this.timelineEl = document.getElementById('workoutTimeline');
        this.setupTimeline();
        this.loadWorkouts();

        // Initialize progress visualizer
        this.progressVisualizer = null;
    }

    static normalizeIntervals(intervals) {
        if (!Array.isArray(intervals)) throw new Error('Invalid workout: expected intervals array');
        return intervals.map((interval, index) => {
            if (!interval || !Number.isFinite(interval.duration) || interval.duration <= 0 || interval.duration > 86400) {
                throw new Error(`Interval ${index + 1}: duration must be between 0 and 86400 seconds`);
            }
            const powerType = interval.powerType || (interval.power !== undefined ? 'absolute' : 'relative');
            const fields = { relative: ['percentage'], absolute: ['power'], ramp: ['percentageLow', 'percentageHigh'] }[powerType];
            if (!Array.isArray(fields)) throw new Error(`Interval ${index + 1}: invalid power type`);
            const normalized = {
                id: Date.now() + Math.random(),
                name: String(interval.name || `Interval ${index + 1}`),
                type: String(interval.type || 'custom'),
                duration: interval.duration,
                powerType
            };
            for (const field of fields) {
                const value = interval[field];
                const maximum = field === 'power' ? 2000 : 300;
                if (!Number.isFinite(value) || value < 0 || value > maximum) {
                    throw new Error(`Interval ${index + 1}: ${field} must be between 0 and ${maximum}`);
                }
                normalized[field] = value;
            }
            return normalized;
        });
    }

    clampIntensity(scale) {
        if (isNaN(scale)) return 1;
        return Math.min(Math.max(scale, 0.5), 1.5);
    }

    loadIntensityScale() {
        try {
            const stored = localStorage.getItem('zwift_intensity_scale');
            if (!stored) return 1;
            const parsed = parseFloat(stored);
            if (isNaN(parsed)) return 1;
            return this.clampIntensity(parsed);
        } catch (err) {
            return 1;
        }
    }

    notifyIntensityUpdate() {
        if (typeof this.onIntensityScaleChange === 'function') {
            this.onIntensityScaleChange(this.intensityScale);
        }
    }

    setupTimeline() {
        this.timelineEl.innerHTML = '<div class="empty-timeline">Click buttons above to add workout intervals</div>';
    }

    setFTP(ftp) {
        this.ftp = ftp;
        this.render();
        this.updateWorkoutInfo();
        this.notifyIntensityUpdate();
    }

    getIntervalPower(interval, elapsedSeconds = 0) {
        if (!interval) return 0;
        const powerType = interval.powerType || 'relative';

        // Handle ramp intervals
        if (powerType === 'ramp') {
            const percentageLow = interval.percentageLow ?? 50;
            const percentageHigh = interval.percentageHigh ?? 100;
            const progress = Math.max(0, Math.min(1, elapsedSeconds / interval.duration));
            const currentPercentage = percentageLow + (percentageHigh - percentageLow) * progress;
            return Math.round(this.ftp * this.intensityScale * (currentPercentage / 100));
        }

        if (powerType === 'absolute') {
            const base = interval.power || 0;
            return Math.round(base * this.intensityScale);
        }

        const percentage = interval.percentage ?? 100;
        return Math.round(this.ftp * this.intensityScale * (percentage / 100));
    }

    setIntensityScale(scale) {
        const clamped = this.clampIntensity(scale);
        const previous = this.intensityScale;
        this.intensityScale = clamped;

        try {
            localStorage.setItem('zwift_intensity_scale', this.intensityScale.toFixed(2));
        } catch (err) {
            // Ignore persistence failures
        }

        this.render();
        this.updateWorkoutInfo();

        if (this.progressVisualizer) {
            this.progressVisualizer.setIntensityScale(this.intensityScale);
        }

        if (this.isRunning) {
            this.applyCurrentIntervalTarget(previous !== clamped);
            this.updateProgress();
        }

        this.notifyIntensityUpdate();
    }

    applyCurrentIntervalTarget(logAdjustment = false) {
        if (!this.isRunning || this.currentIntervalIndex < 0 || Date.now() < this.workoutStartTime) return;

        const currentInterval = this.intervals[this.currentIntervalIndex];
        if (!currentInterval) return;

        const elapsed = (Date.now() - this.intervalStartTime) / 1000;
        const power = this.getIntervalPower(currentInterval, elapsed);

        if (logAdjustment) {
            const currentName = currentInterval.name || 'Interval';
            this.ftms.log(`${currentName}: intensity ${Math.round(this.intensityScale * 100)}% → ${power}W`, 'info');
        }

        this.ftms.setTargetPower(power);
        if (this.onTargetPowerChange) {
            this.onTargetPowerChange(power);
        }
    }

    addInterval(type) {
        if (this.isRunning) return;
        const presets = {
            warmup: { percentage: 50, duration: 300, type: 'warmup', name: 'Warmup', powerType: 'relative' },
            endurance: { percentage: 65, duration: 600, type: 'endurance', name: 'Endurance', powerType: 'relative' },
            tempo: { percentage: 85, duration: 600, type: 'tempo', name: 'Tempo', powerType: 'relative' },
            threshold: { percentage: 100, duration: 300, type: 'threshold', name: 'Threshold', powerType: 'relative' },
            vo2max: { percentage: 120, duration: 180, type: 'vo2max', name: 'VO2 Max', powerType: 'relative' },
            cooldown: { percentage: 40, duration: 300, type: 'cooldown', name: 'Cooldown', powerType: 'relative' }
        };

        const preset = presets[type];
        if (!preset) return;

        this.intervals.push({
            id: Date.now(),
            ...preset
        });

        this.render();
        this.updateWorkoutInfo();
    }

    removeInterval(id) {
        if (this.isRunning) return;
        this.intervals = this.intervals.filter(i => i.id !== id);
        this.render();
        this.updateWorkoutInfo();
    }

    clearWorkout() {
        if (this.isRunning) return;
        if (confirm('Clear all intervals?')) {
            this.intervals = [];
            this.render();
            this.updateWorkoutInfo();
        }
    }

    updateInterval(id, updates) {
        if (this.isRunning) return;
        const interval = this.intervals.find(i => i.id === id);
        if (interval) {
            Object.assign(interval, updates);
            this.render();
            this.updateWorkoutInfo();
        }
    }

    render() {
        if (this.intervals.length === 0) {
            this.setupTimeline();
            return;
        }

        this.timelineEl.innerHTML = '<div class="timeline-grid" id="timelineGrid"></div>';
        const grid = document.getElementById('timelineGrid');

        const totalDuration = this.intervals.reduce((sum, i) => sum + i.duration, 0);
        const pixelsPerSecond = Math.max(0.5, Math.min(2, 800 / totalDuration));

        this.intervals.forEach((interval, index) => {
            const el = this.createIntervalElement(interval, index, pixelsPerSecond);
            grid.appendChild(el);
        });
    }

    createIntervalElement(interval, index, pixelsPerSecond) {
        const el = document.createElement('div');
        const powerType = interval.powerType || 'relative';
        const rampClass = powerType === 'ramp' ? ' interval-ramp' : '';
        el.className = `workout-interval interval-${interval.type}${rampClass}`;
        el.style.width = `${interval.duration * pixelsPerSecond}px`;
        el.dataset.intervalId = interval.id;

        // Calculate power based on powerType (relative, absolute, or ramp)
        let power, displayText;

        if (powerType === 'ramp') {
            const percentageLow = interval.percentageLow ?? 50;
            const percentageHigh = interval.percentageHigh ?? 100;
            const powerLow = Math.round(this.ftp * this.intensityScale * (percentageLow / 100));
            const powerHigh = Math.round(this.ftp * this.intensityScale * (percentageHigh / 100));
            power = powerHigh; // Use high power for display
            displayText = `${percentageLow}% → ${percentageHigh}% FTP`;
        } else if (powerType === 'absolute') {
            const basePower = interval.power || 0;
            power = this.getIntervalPower(interval);
            displayText = `${basePower}W Absolute${this.intensityScale !== 1 ? ` → ${power}W` : ''}`;
        } else {
            const percentage = interval.percentage ?? 100;
            power = this.getIntervalPower(interval);
            const scaledPercent = Math.round(percentage * this.intensityScale);
            displayText = `${percentage}% FTP${this.intensityScale !== 1 ? ` → ${scaledPercent}%` : ''}`;
        }

        el.innerHTML = `
            <div class="interval-controls">
                <button class="interval-delete" aria-label="Delete interval">×</button>
            </div>
            <button type="button" class="interval-info interval-edit"></button>
            <div class="interval-power">${power}W</div>
            <div class="interval-percentage">${displayText}</div>
            <div class="interval-duration">${this.formatDuration(interval.duration)}</div>
            <div class="resize-handle"></div>
        `;

        el.querySelector('.interval-info').textContent = interval.name;
        el.querySelector('.interval-delete').addEventListener('click', () => this.removeInterval(interval.id));

        el.querySelector('.interval-edit').setAttribute('aria-label', `Edit ${interval.name}, ${this.formatDuration(interval.duration)}`);

        // Make draggable
        el.draggable = !this.isRunning;
        el.addEventListener('dragstart', (e) => this.handleDragStart(e, interval));
        el.addEventListener('dragend', (e) => this.handleDragEnd(e));
        el.addEventListener('dragover', (e) => this.handleDragOver(e));
        el.addEventListener('drop', (e) => this.handleDrop(e, interval));

        // Click to edit
        el.addEventListener('click', (e) => {
            if (e.target.classList.contains('interval-delete')) return;
            this.showEditDialog(interval);
        });

        // Highlight current interval during workout
        if (this.isRunning && index === this.currentIntervalIndex) {
            el.classList.add('selected');
        }

        return el;
    }

    handleDragStart(e, interval) {
        this.draggedInterval = interval;
        e.target.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    handleDragEnd(e) {
        e.target.classList.remove('dragging');
        this.draggedInterval = null;
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    handleDrop(e, targetInterval) {
        e.preventDefault();
        if (this.isRunning || !this.draggedInterval || this.draggedInterval.id === targetInterval.id) return;

        const draggedIndex = this.intervals.findIndex(i => i.id === this.draggedInterval.id);
        const targetIndex = this.intervals.findIndex(i => i.id === targetInterval.id);

        // Reorder
        this.intervals.splice(draggedIndex, 1);
        this.intervals.splice(targetIndex, 0, this.draggedInterval);

        this.render();
    }

    showEditDialog(interval) {
        if (this.isRunning) return;
        this.selectedInterval = interval.id;
        const powerType = interval.powerType || 'relative';
        document.getElementById('intervalName').value = interval.name;
        document.getElementById('intervalDuration').value = interval.duration;
        document.getElementById('intervalPowerType').value = powerType;
        document.getElementById('intervalPower').value = powerType === 'absolute' ? interval.power : powerType === 'ramp' ? interval.percentageLow : interval.percentage;
        document.getElementById('intervalRampEnd').value = interval.percentageHigh ?? 100;
        document.getElementById('intervalEditError').textContent = '';
        this.updateIntervalEditor();
        document.getElementById('intervalDialog').showModal();
    }

    updateIntervalEditor() {
        const type = document.getElementById('intervalPowerType').value;
        document.getElementById('intervalPowerLabel').textContent = type === 'absolute' ? 'Power (watts)' : type === 'ramp' ? 'Start intensity (% FTP)' : 'Intensity (% FTP)';
        document.getElementById('intervalPower').max = type === 'absolute' ? 2000 : 300;
        document.getElementById('intervalRampEndField').hidden = type !== 'ramp';
        document.getElementById('intervalRampEnd').required = type === 'ramp';
        document.getElementById('intervalRampEnd').disabled = type !== 'ramp';
    }

    saveIntervalEdit(event) {
        event.preventDefault();
        if (this.isRunning) return;
        const index = this.intervals.findIndex(interval => interval.id === this.selectedInterval);
        if (index < 0) return;
        const original = this.intervals[index];
        const powerType = document.getElementById('intervalPowerType').value;
        const value = Number(document.getElementById('intervalPower').value);
        try {
            const [interval] = WorkoutDesigner.normalizeIntervals([{
                name: document.getElementById('intervalName').value.trim() || 'Interval',
                type: original.type,
                duration: Number(document.getElementById('intervalDuration').value),
                powerType,
                ...(powerType === 'absolute' ? { power: value } : powerType === 'ramp'
                    ? { percentageLow: value, percentageHigh: Number(document.getElementById('intervalRampEnd').value) }
                    : { percentage: value })
            }]);
            this.intervals[index] = { ...interval, id: original.id };
            this.render();
            this.updateWorkoutInfo();
            document.getElementById('intervalDialog').close();
        } catch (error) {
            document.getElementById('intervalEditError').textContent = error.message;
        }
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    updateWorkoutInfo() {
        const totalDuration = this.intervals.reduce((sum, i) => sum + i.duration, 0);
        const totalWork = this.intervals.reduce((sum, i) => {
            const power = this.getIntervalPower(i, i.duration / 2);
            return sum + (power * i.duration);
        }, 0) / 1000; // kJ
        const avgPower = totalDuration > 0 ? Math.round(totalWork * 1000 / totalDuration) : 0;

        document.getElementById('totalDuration').textContent = this.formatDuration(totalDuration);
        document.getElementById('avgPower').textContent = avgPower;
        document.getElementById('totalWork').textContent = totalWork.toFixed(1);
        const readyInfo = document.getElementById('workoutReadyInfo');
        if (readyInfo) readyInfo.textContent = `${this.formatDuration(totalDuration)} · ${this.intervals.length} intervals · ${avgPower}W average`;
        if (window.Alpine) {
            const workout = Alpine.store('app').workout;
            workout.loaded = this.intervals.length > 0;
            workout.name = this.name;
            workout.timeTotal = totalDuration;
        }
    }

    async startWorkout(syncStartTime = null) {
        if (this.isRunning) return;

        if (this.intervals.length === 0) {
            alert('Please add some intervals first!');
            return;
        }

        if (!this.ftms.isConnected()) {
            alert('Please connect to your trainer first!');
            return;
        }

        // Validate before starting timers or sending trainer commands.
        try {
            WorkoutDesigner.normalizeIntervals(this.intervals);
        } catch (error) {
            alert(error.message);
            return;
        }
        if (syncStartTime !== null && !Number.isFinite(syncStartTime)) return;

        this.workoutStartTime = syncStartTime ?? Date.now();
        const now = Date.now();
        const elapsedTotal = now - this.workoutStartTime;

        // Find which interval we should be in based on elapsed time
        let currentIntervalIndex = 0;
        let elapsedBeforeCurrentInterval = 0;

        if (elapsedTotal > 0) {
            // Fast-forward to correct interval for mid-workout join
            let accumulatedTime = 0;
            for (let i = 0; i < this.intervals.length; i++) {
                const intervalDuration = this.intervals[i].duration * 1000;
                if (accumulatedTime + intervalDuration > elapsedTotal) {
                    currentIntervalIndex = i;
                    elapsedBeforeCurrentInterval = accumulatedTime;
                    break;
                }
                accumulatedTime += intervalDuration;
            }

            // If we've passed all intervals, workout is over
            if (currentIntervalIndex === 0 && elapsedBeforeCurrentInterval === 0 && elapsedTotal > 0) {
                const totalDuration = this.intervals.reduce((sum, i) => sum + i.duration * 1000, 0);
                if (elapsedTotal >= totalDuration) {
                    this.ftms.log('⚠️ Workout already completed', 'warning');
                    return;
                }
            }

            this.ftms.log(`⏩ Joining workout at interval ${currentIntervalIndex + 1}`, 'success');
        } else {
            this.ftms.log('🎯 Starting workout!', 'success');
        }

        this.isRunning = true;
        this.currentIntervalIndex = currentIntervalIndex;
        this.intervalStartTime = this.workoutStartTime + elapsedBeforeCurrentInterval;

        // Initialize progress visualizer
        this.progressVisualizer ||= new WorkoutProgressVisualizer('workoutProgressChart');
        this.progressVisualizer.setWorkout(this.intervals, this.ftp, this.intensityScale);
        this.progressVisualizer.start(this.workoutStartTime);

        // Start progress update loop (update every 100ms for smooth progress bar)
        this.progressUpdateInterval = setInterval(() => {
            this.updateProgress();
        }, 100);

        if (this.onWorkoutStart) {
            this.onWorkoutStart();
        }

        if (this.workoutStartTime > Date.now()) {
            this.workoutTimer = setTimeout(() => this.executeInterval(currentIntervalIndex), this.workoutStartTime - Date.now());
        } else {
            await this.executeInterval(currentIntervalIndex);
        }
    }

    async executeInterval(index) {
        if (!this.isRunning) return;
        clearTimeout(this.workoutTimer);
        clearInterval(this.rampUpdateInterval);
        this.workoutTimer = null;
        this.rampUpdateInterval = null;
        if (Date.now() < this.workoutStartTime) {
            this.workoutTimer = setTimeout(() => this.executeInterval(index), this.workoutStartTime - Date.now());
            return;
        }

        let startTime = this.workoutStartTime;
        for (let i = 0; i < index; i++) {
            startTime += this.intervals[i].duration * 1000;
        }
        // Background tabs can delay timers: skip expired intervals, not the workout clock.
        while (index < this.intervals.length && Date.now() >= startTime + this.intervals[index].duration * 1000) {
            startTime += this.intervals[index].duration * 1000;
            index++;
        }
        if (index >= this.intervals.length) {
            this.stopWorkout();
            return;
        }

        this.currentIntervalIndex = index;
        this.intervalStartTime = startTime;
        const interval = this.intervals[index];
        const powerType = interval.powerType || 'relative';
        const power = this.getIntervalPower(interval, (Date.now() - startTime) / 1000);
        let powerDisplay;
        if (powerType === 'ramp') {
            const percentageLow = interval.percentageLow ?? 50;
            const percentageHigh = interval.percentageHigh ?? 100;
            powerDisplay = `Ramp from ${percentageLow}% to ${percentageHigh}% FTP`;
        } else if (powerType === 'absolute') {
            const basePower = interval.power || 0;
            powerDisplay = `${power}W (Absolute${this.intensityScale !== 1 ? ` from ${basePower}W` : ''})`;
        } else {
            const percentage = interval.percentage ?? 100;
            const scaledPercent = Math.round(percentage * this.intensityScale);
            powerDisplay = `${power}W (${percentage}% FTP${this.intensityScale !== 1 ? ` → ${scaledPercent}%` : ''})`;
        }

        this.ftms.log(`${interval.name}: ${powerDisplay} for ${this.formatDuration(interval.duration)}`, 'info');
        this.render();
        this.updateProgress();

        // For ramp intervals, continuously update power
        if (powerType === 'ramp') {
            this.rampUpdateInterval = setInterval(() => {
                const elapsed = (Date.now() - this.intervalStartTime) / 1000;
                if (elapsed >= interval.duration) {
                    this.executeInterval(index + 1);
                    return;
                }
                const currentPower = this.getIntervalPower(interval, elapsed);
                this.ftms.setTargetPower(currentPower);
                if (this.onTargetPowerChange) {
                    this.onTargetPowerChange(currentPower);
                }
            }, 1000); // Update every second
        }

        // Schedule against the shared clock, independent of Bluetooth write latency.
        this.workoutTimer = setTimeout(() => this.executeInterval(index + 1),
            Math.max(0, startTime + interval.duration * 1000 - Date.now()));
        this.ftms.setTargetPower(power);
        if (this.onTargetPowerChange) {
            this.onTargetPowerChange(power);
        }
    }

    stopWorkout() {
        if (!this.isRunning) return;
        if (this.workoutTimer) {
            clearTimeout(this.workoutTimer);
            this.workoutTimer = null;
        }

        if (this.progressUpdateInterval) {
            clearInterval(this.progressUpdateInterval);
            this.progressUpdateInterval = null;
        }

        if (this.rampUpdateInterval) {
            clearInterval(this.rampUpdateInterval);
            this.rampUpdateInterval = null;
        }

        this.isRunning = false;
        this.currentIntervalIndex = -1;

        this.ftms.log('Workout stopped', 'warning');
        this.render();

        // Clear progress visualizer
        if (this.progressVisualizer) {
            this.progressVisualizer.clear();
        }

        // Reset power
        this.ftms.setTargetPower(0);
        if (this.onTargetPowerChange) {
            this.onTargetPowerChange(0);
        }

        if (this.onWorkoutStop) {
            this.onWorkoutStop();
        }
    }

    updateProgress() {
        if (!this.isRunning || this.currentIntervalIndex < 0) return;

        const now = Date.now();
        const elapsedInInterval = (now - this.intervalStartTime) / 1000; // seconds
        const totalElapsed = (now - this.workoutStartTime) / 1000; // seconds

        // Update progress visualizer
        if (this.progressVisualizer) {
            this.progressVisualizer.updateProgress(this.currentIntervalIndex, elapsedInInterval);
        }

        // Update current interval info
        const currentInterval = this.intervals[this.currentIntervalIndex];
        if (currentInterval) {
            const power = this.getIntervalPower(currentInterval, elapsedInInterval);
            const intensityPercent = Math.round(this.intensityScale * 100);
            const remaining = Math.max(0, currentInterval.duration - elapsedInInterval);

            document.getElementById('currentIntervalName').textContent = currentInterval.name;
            document.getElementById('currentIntervalTarget').textContent = `${power}W (${intensityPercent}% • ${this.formatDuration(Math.round(remaining))} left)`;
            
            // Show countdown when less than 10 seconds remaining
            const countdownEl = document.getElementById('currentIntervalCountdown');
            const countdownSecsEl = document.getElementById('countdownSeconds');
            if (countdownEl && countdownSecsEl && remaining <= 10 && remaining > 0) {
                countdownEl.style.display = 'block';
                countdownSecsEl.textContent = Math.ceil(remaining) + 's';
            } else if (countdownEl) {
                countdownEl.style.display = 'none';
            }
        }

        // Update next interval info
        const nextInterval = this.intervals[this.currentIntervalIndex + 1];
        if (nextInterval) {
            const nextPower = this.getIntervalPower(nextInterval);
            
            document.getElementById('nextIntervalName').textContent = nextInterval.name;
            document.getElementById('nextIntervalTarget').textContent = `${nextPower}W`;
        } else {
            document.getElementById('nextIntervalName').textContent = 'Finish';
            document.getElementById('nextIntervalTarget').textContent = 'Last interval!';
        }

        // Update workout progress time
        const totalDuration = this.intervals.reduce((sum, i) => sum + i.duration, 0);
        const totalRemaining = Math.max(0, totalDuration - totalElapsed);
        document.getElementById('workoutProgressTime').textContent =
            `${this.formatDuration(Math.round(totalElapsed))} / ${this.formatDuration(totalDuration)} (${this.formatDuration(Math.round(totalRemaining))} left)`;
    }

    // Save/Load Functionality
    saveWorkout(name) {
        if (!name) {
            name = prompt('Enter workout name:');
            if (!name) return;
        }

        this.name = name;
        this.updateWorkoutInfo();
        const workout = { ...this.exportWorkoutData(), name };
        if (!workout.intervals) return;

        const workouts = { ...this.getStoredWorkouts(), [name]: workout };
        localStorage.setItem('zwift_workouts', JSON.stringify(workouts));

        this.ftms.log(`Saved workout: ${name}`, 'success');
    }

    loadWorkout(name) {
        if (this.isRunning) return;
        const workouts = this.getStoredWorkouts();
        const workout = workouts[name];

        if (!workout) {
            alert('Workout not found');
            return;
        }

        try {
            this.intervals = WorkoutDesigner.normalizeIntervals(workout.intervals);
        } catch (error) {
            alert(`Cannot load workout: ${error.message}`);
            return;
        }
        
        if (workout.ftp) {
            this.ftp = workout.ftp;
            document.getElementById('ftpInput').value = this.ftp;
        }

        this.name = name;
        this.description = String(workout.description || '');
        document.getElementById('workoutName').value = name;
        this.render();
        this.updateWorkoutInfo();
        this.ftms.log(`Loaded workout: ${name}`, 'success');
    }

    deleteWorkout(name) {
        if (!confirm(`Delete workout "${name}"?`)) return;

        const workouts = this.getStoredWorkouts();
        delete workouts[name];
        localStorage.setItem('zwift_workouts', JSON.stringify(workouts));

        this.ftms.log(`Deleted workout: ${name}`, 'warning');
    }

    getStoredWorkouts() {
        const stored = localStorage.getItem('zwift_workouts');
        return stored ? JSON.parse(stored) : {};
    }

    loadWorkouts() {
        // This will be called on init to show available workouts
        return Object.keys(this.getStoredWorkouts());
    }

    exportWorkout() {
        if (this.intervals.length === 0) {
            alert('No workout to export');
            return;
        }

        const workout = this.exportWorkoutData();

        const dataStr = JSON.stringify(workout, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${workout.name.replace(/\s+/g, '_')}.json`;
        link.click();
        URL.revokeObjectURL(url);

        this.ftms.log('Workout exported', 'success');
    }

    importWorkout(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const workout = JSON.parse(e.target.result);

                const workoutName = workout?.name || 'Imported Workout';
                this.importWorkoutData({ ...workout, name: workoutName });
                this.ftms.log(`✓ Imported workout: ${workoutName} (${this.intervals.length} intervals)`, 'success');
                
                // Refresh workout library and switch to Workouts tab to show the imported workout
                if (window.app) {
                    if (typeof window.app.refreshWorkoutLibrary === 'function') {
                        window.app.refreshWorkoutLibrary();
                    }
                    // Switch to Workouts tab to show the imported workout
                    if (typeof window.app.switchTab === 'function') {
                        setTimeout(() => {
                            window.app.switchTab('workouts');
                            alert(`✓ Successfully imported "${workoutName}"!\n\nThe workout is now available in your library.`);
                        }, 100);
                    }
                }
            } catch (err) {
                this.ftms.log(`✗ Failed to import workout: ${err.message}`, 'error');
                alert('Failed to import workout: ' + err.message);
            }
        };
        
        reader.onerror = () => {
            this.ftms.log('✗ Failed to read file', 'error');
            alert('Failed to read file');
        };
        
        reader.readAsText(file);
    }

    // Export current workout data without prompts (for ZWO export)
    exportWorkoutData() {
        if (this.intervals.length === 0) {
            return null;
        }

        return {
            name: this.name,
            description: this.description,
            ftp: this.ftp,
            intervals: this.intervals.map(interval => {
                const cleanInterval = {
                    name: interval.name,
                    type: interval.type,
                    duration: interval.duration,
                    powerType: interval.powerType || 'relative'
                };

                if (cleanInterval.powerType === 'ramp') {
                    cleanInterval.percentageLow = interval.percentageLow;
                    cleanInterval.percentageHigh = interval.percentageHigh;
                } else if (cleanInterval.powerType === 'absolute') {
                    cleanInterval.power = interval.power;
                } else {
                    cleanInterval.percentage = interval.percentage;
                }

                return cleanInterval;
            }),
            created: new Date().toISOString(),
            version: '1.0'
        };
    }

    // Import workout data directly (for ZWO import)
    importWorkoutData(workout) {
        if (this.isRunning) throw new Error('Stop the workout before importing another one');
        // Validate workout structure
        if (!workout || typeof workout !== 'object') {
            console.error('Invalid workout object:', workout);
            throw new Error('Invalid workout format: expected object');
        }
        if (!workout.intervals || !Array.isArray(workout.intervals)) {
            console.error('Invalid intervals:', workout.intervals);
            throw new Error('Invalid workout format: missing or invalid intervals array');
        }

        const validIntervals = WorkoutDesigner.normalizeIntervals(workout.intervals);
        if (workout.ftp !== undefined && (!Number.isFinite(workout.ftp) || workout.ftp < 50 || workout.ftp > 500)) {
            throw new Error('FTP must be between 50 and 500 watts');
        }

        this.intervals = validIntervals;
        this.name = String(workout.name || 'Imported workout');
        this.description = String(workout.description || '');
        document.getElementById('workoutName').value = this.name;

        if (workout.ftp && typeof workout.ftp === 'number') {
            this.ftp = workout.ftp;
            document.getElementById('ftpInput').value = this.ftp;
        }

        this.render();
        this.updateWorkoutInfo();

        // Auto-save if workout has a name
        if (workout.name) {
            this.saveWorkout(this.name);

            if (window.app) {
                if (typeof window.app.refreshWorkoutLibrary === 'function') {
                    window.app.refreshWorkoutLibrary();
                }
            }
        }
    }

    showWorkoutManager() {
        const workouts = this.getStoredWorkouts();
        const names = Object.keys(workouts);

        if (names.length === 0) {
            alert('No saved workouts');
            return;
        }

        const choice = prompt('Enter workout name to load:\n\n' + names.join('\n'));
        if (choice && workouts[choice]) {
            this.loadWorkout(choice);
        }
    }
}
