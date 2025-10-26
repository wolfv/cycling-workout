// Workout Designer with drag-and-drop functionality
class WorkoutDesigner {
    constructor(ftmsController) {
        this.ftms = ftmsController;
        this.intervals = [];
        this.selectedInterval = null;
        this.draggedInterval = null;
        this.isRunning = false;
        this.currentIntervalIndex = -1;
        this.workoutTimer = null;
        this.workoutStartTime = null;
        this.onTargetPowerChange = null;
        this.onWorkoutStart = null;
        this.onWorkoutStop = null;
        this.ftp = 200; // Default FTP

        this.timelineEl = document.getElementById('workoutTimeline');
        this.setupTimeline();
        this.loadWorkouts();
    }

    setupTimeline() {
        this.timelineEl.innerHTML = '<div class="empty-timeline">Click buttons above to add workout intervals</div>';
    }

    setFTP(ftp) {
        this.ftp = ftp;
        this.render();
        this.updateWorkoutInfo();
    }

    addInterval(type) {
        const presets = {
            warmup: { percentage: 50, duration: 300, type: 'warmup', name: 'Warmup' },
            endurance: { percentage: 65, duration: 600, type: 'endurance', name: 'Endurance' },
            tempo: { percentage: 85, duration: 600, type: 'tempo', name: 'Tempo' },
            threshold: { percentage: 100, duration: 300, type: 'threshold', name: 'Threshold' },
            vo2max: { percentage: 120, duration: 180, type: 'vo2max', name: 'VO2 Max' },
            cooldown: { percentage: 40, duration: 300, type: 'cooldown', name: 'Cooldown' }
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
        this.intervals = this.intervals.filter(i => i.id !== id);
        this.render();
        this.updateWorkoutInfo();
    }

    clearWorkout() {
        if (confirm('Clear all intervals?')) {
            this.intervals = [];
            this.render();
            this.updateWorkoutInfo();
        }
    }

    updateInterval(id, updates) {
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
        el.className = `workout-interval interval-${interval.type}`;
        el.style.width = `${interval.duration * pixelsPerSecond}px`;
        el.dataset.intervalId = interval.id;

        const power = Math.round(this.ftp * (interval.percentage / 100));

        el.innerHTML = `
            <div class="interval-controls">
                <button class="interval-delete" onclick="workoutDesigner.removeInterval(${interval.id})">×</button>
            </div>
            <div class="interval-info">${interval.name}</div>
            <div class="interval-power">${power}W</div>
            <div class="interval-percentage">${interval.percentage}% FTP</div>
            <div class="interval-duration">${this.formatDuration(interval.duration)}</div>
            <div class="resize-handle"></div>
        `;

        // Make draggable
        el.draggable = true;
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
        if (!this.draggedInterval || this.draggedInterval.id === targetInterval.id) return;

        const draggedIndex = this.intervals.findIndex(i => i.id === this.draggedInterval.id);
        const targetIndex = this.intervals.findIndex(i => i.id === targetInterval.id);

        // Reorder
        this.intervals.splice(draggedIndex, 1);
        const newTargetIndex = this.intervals.findIndex(i => i.id === targetInterval.id);
        this.intervals.splice(newTargetIndex, 0, this.draggedInterval);

        this.render();
    }

    showEditDialog(interval) {
        const newPercentage = prompt(`Set intensity for ${interval.name} (% of FTP):`, interval.percentage);
        if (newPercentage !== null) {
            const percentage = parseInt(newPercentage);
            if (!isNaN(percentage) && percentage >= 10 && percentage <= 200) {
                interval.percentage = percentage;
            }
        }

        const newDuration = prompt(`Set duration for ${interval.name} (seconds):`, interval.duration);
        if (newDuration !== null) {
            const duration = parseInt(newDuration);
            if (!isNaN(duration) && duration >= 10 && duration <= 7200) {
                interval.duration = duration;
            }
        }

        this.render();
        this.updateWorkoutInfo();
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    updateWorkoutInfo() {
        const totalDuration = this.intervals.reduce((sum, i) => sum + i.duration, 0);
        const totalWork = this.intervals.reduce((sum, i) => {
            const power = Math.round(this.ftp * (i.percentage / 100));
            return sum + (power * i.duration);
        }, 0) / 1000; // kJ
        const avgPower = totalDuration > 0 ? Math.round(totalWork * 1000 / totalDuration) : 0;

        document.getElementById('totalDuration').textContent = this.formatDuration(totalDuration);
        document.getElementById('avgPower').textContent = avgPower;
        document.getElementById('totalWork').textContent = totalWork.toFixed(1);
    }

    async startWorkout() {
        if (this.intervals.length === 0) {
            alert('Please add some intervals first!');
            return;
        }

        if (!this.ftms.isConnected()) {
            alert('Please connect to your trainer first!');
            return;
        }

        this.isRunning = true;
        this.currentIntervalIndex = 0;
        this.workoutStartTime = Date.now();

        this.ftms.log('🎯 Starting workout!', 'success');

        if (this.onWorkoutStart) {
            this.onWorkoutStart();
        }

        await this.executeInterval(0);
    }

    async executeInterval(index) {
        if (!this.isRunning || index >= this.intervals.length) {
            this.stopWorkout();
            return;
        }

        this.currentIntervalIndex = index;
        const interval = this.intervals[index];
        const power = Math.round(this.ftp * (interval.percentage / 100));

        this.ftms.log(`${interval.name}: ${power}W (${interval.percentage}% FTP) for ${this.formatDuration(interval.duration)}`, 'info');
        this.render();

        // Set target power
        await this.ftms.setTargetPower(power);
        if (this.onTargetPowerChange) {
            this.onTargetPowerChange(power);
        }

        // Wait for interval duration
        this.workoutTimer = setTimeout(() => {
            this.executeInterval(index + 1);
        }, interval.duration * 1000);
    }

    stopWorkout() {
        if (this.workoutTimer) {
            clearTimeout(this.workoutTimer);
            this.workoutTimer = null;
        }

        this.isRunning = false;
        this.currentIntervalIndex = -1;

        this.ftms.log('Workout stopped', 'warning');
        this.render();

        // Reset power
        this.ftms.setTargetPower(0);
        if (this.onTargetPowerChange) {
            this.onTargetPowerChange(0);
        }

        if (this.onWorkoutStop) {
            this.onWorkoutStop();
        }
    }

    // Save/Load Functionality
    saveWorkout(name) {
        if (!name) {
            name = prompt('Enter workout name:');
            if (!name) return;
        }

        const workout = {
            name,
            ftp: this.ftp,
            intervals: this.intervals,
            created: new Date().toISOString()
        };

        const workouts = this.getStoredWorkouts();
        workouts[name] = workout;
        localStorage.setItem('zwift_workouts', JSON.stringify(workouts));

        this.ftms.log(`Saved workout: ${name}`, 'success');
    }

    loadWorkout(name) {
        const workouts = this.getStoredWorkouts();
        const workout = workouts[name];

        if (!workout) {
            alert('Workout not found');
            return;
        }

        this.intervals = workout.intervals.map(i => ({...i, id: Date.now() + Math.random()}));
        if (workout.ftp) {
            this.ftp = workout.ftp;
            document.getElementById('ftpInput').value = this.ftp;
        }

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

        const workout = {
            name: prompt('Workout name:', 'My Workout') || 'Workout',
            ftp: this.ftp,
            intervals: this.intervals,
            created: new Date().toISOString()
        };

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

                if (!workout.intervals || !Array.isArray(workout.intervals)) {
                    throw new Error('Invalid workout format');
                }

                this.intervals = workout.intervals.map(i => ({...i, id: Date.now() + Math.random()}));
                if (workout.ftp) {
                    this.ftp = workout.ftp;
                    document.getElementById('ftpInput').value = this.ftp;
                }

                this.render();
                this.updateWorkoutInfo();
                this.ftms.log(`Imported workout: ${workout.name || 'Unknown'}`, 'success');
            } catch (err) {
                alert('Failed to import workout: ' + err.message);
            }
        };
        reader.readAsText(file);
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
