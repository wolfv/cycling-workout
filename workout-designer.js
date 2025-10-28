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
        this.intervalStartTime = null;
        this.progressUpdateInterval = null;
        this.onTargetPowerChange = null;
        this.onWorkoutStart = null;
        this.onWorkoutStop = null;
        this.ftp = 200; // Default FTP

        this.timelineEl = document.getElementById('workoutTimeline');
        this.setupTimeline();
        this.loadWorkouts();

        // Initialize progress visualizer
        this.progressVisualizer = null;
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

        // Calculate power based on powerType (relative or absolute)
        const powerType = interval.powerType || 'relative';
        let power, displayText;
        
        if (powerType === 'absolute') {
            power = interval.power || 0;
            displayText = `${power}W (Absolute)`;
        } else {
            const percentage = interval.percentage || 100;
            power = Math.round(this.ftp * (percentage / 100));
            displayText = `${percentage}% FTP`;
        }

        el.innerHTML = `
            <div class="interval-controls">
                <button class="interval-delete" onclick="workoutDesigner.removeInterval(${interval.id})">×</button>
            </div>
            <div class="interval-info">${interval.name}</div>
            <div class="interval-power">${power}W</div>
            <div class="interval-percentage">${displayText}</div>
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
        // Determine current power type
        const powerType = interval.powerType || 'relative';
        
        // Ask user to choose power type
        const typeChoice = confirm('Click OK for % of FTP (relative)\nClick Cancel for Absolute Watts');
        
        if (typeChoice) {
            // Relative FTP
            const newPercentage = prompt(`Set intensity for ${interval.name} (% of FTP):`, interval.percentage || 100);
            if (newPercentage !== null) {
                const percentage = parseInt(newPercentage);
                if (!isNaN(percentage) && percentage >= 10 && percentage <= 200) {
                    interval.percentage = percentage;
                    interval.powerType = 'relative';
                    delete interval.power; // Remove absolute power if switching
                }
            }
        } else {
            // Absolute Watts
            const currentPower = interval.power || Math.round(this.ftp * ((interval.percentage || 100) / 100));
            const newPower = prompt(`Set absolute power for ${interval.name} (Watts):`, currentPower);
            if (newPower !== null) {
                const power = parseInt(newPower);
                if (!isNaN(power) && power >= 10 && power <= 1000) {
                    interval.power = power;
                    interval.powerType = 'absolute';
                    delete interval.percentage; // Remove percentage if switching
                }
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
            // Calculate power based on powerType
            const powerType = i.powerType || 'relative';
            let power;
            
            if (powerType === 'absolute') {
                power = i.power || 0;
            } else {
                const percentage = i.percentage || 100;
                power = Math.round(this.ftp * (percentage / 100));
            }
            
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
        this.intervalStartTime = Date.now();

        this.ftms.log('🎯 Starting workout!', 'success');

        // Initialize progress visualizer
        this.progressVisualizer = new WorkoutProgressVisualizer('workoutProgressChart');
        this.progressVisualizer.setWorkout(this.intervals, this.ftp);
        this.progressVisualizer.start(this.workoutStartTime);

        // Start progress update loop (update every 100ms for smooth progress bar)
        this.progressUpdateInterval = setInterval(() => {
            this.updateProgress();
        }, 100);

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
        this.intervalStartTime = Date.now();
        const interval = this.intervals[index];
        
        // Calculate power based on powerType
        const powerType = interval.powerType || 'relative';
        let power;
        
        if (powerType === 'absolute') {
            power = interval.power || 0;
        } else {
            const percentage = interval.percentage || 100;
            power = Math.round(this.ftp * (percentage / 100));
        }

        const powerDisplay = powerType === 'absolute' 
            ? `${power}W (Absolute)` 
            : `${power}W (${interval.percentage}% FTP)`;
        
        this.ftms.log(`${interval.name}: ${powerDisplay} for ${this.formatDuration(interval.duration)}`, 'info');
        this.render();
        this.updateProgress();

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

        if (this.progressUpdateInterval) {
            clearInterval(this.progressUpdateInterval);
            this.progressUpdateInterval = null;
        }

        this.isRunning = false;
        this.currentIntervalIndex = -1;

        this.ftms.log('Workout stopped', 'warning');
        this.render();

        // Clear progress visualizer
        if (this.progressVisualizer) {
            this.progressVisualizer.clear();
            this.progressVisualizer = null;
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
            // Calculate power based on powerType
            const powerType = currentInterval.powerType || 'relative';
            let power;
            
            if (powerType === 'absolute') {
                power = currentInterval.power || 0;
            } else {
                const percentage = currentInterval.percentage || 100;
                power = Math.round(this.ftp * (percentage / 100));
            }
            
            const remaining = Math.max(0, currentInterval.duration - elapsedInInterval);

            document.getElementById('currentIntervalName').textContent = currentInterval.name;
            document.getElementById('currentIntervalTarget').textContent = `${power}W (${this.formatDuration(Math.round(remaining))} left)`;
            
            // Show countdown when less than 10 seconds remaining
            const countdownEl = document.getElementById('currentIntervalCountdown');
            const countdownSecsEl = document.getElementById('countdownSeconds');
            if (countdownEl && countdownSecsEl && remaining <= 10000 && remaining > 0) {
                countdownEl.style.display = 'block';
                countdownSecsEl.textContent = Math.ceil(remaining) + 's';
            } else if (countdownEl) {
                countdownEl.style.display = 'none';
            }
        }

        // Update next interval info
        const nextInterval = this.intervals[this.currentIntervalIndex + 1];
        if (nextInterval) {
            // Calculate power for next interval
            const powerType = nextInterval.powerType || 'relative';
            let nextPower;
            
            if (powerType === 'absolute') {
                nextPower = nextInterval.power || 0;
            } else {
                const percentage = nextInterval.percentage || 100;
                nextPower = Math.round(this.ftp * (percentage / 100));
            }
            
            document.getElementById('nextIntervalName').textContent = nextInterval.name;
            document.getElementById('nextIntervalTarget').textContent = `${nextPower}W for ${this.formatDuration(nextInterval.duration)}`;
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

        const workout = {
            name,
            ftp: this.ftp,
            intervals: this.intervals.map(interval => ({
                name: interval.name,
                type: interval.type,
                duration: interval.duration,
                powerType: interval.powerType || 'relative',
                ...(interval.powerType === 'absolute' ? { power: interval.power } : { percentage: interval.percentage })
            })),
            created: new Date().toISOString(),
            version: '1.0'
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

        // Normalize intervals to handle both old and new formats
        this.intervals = workout.intervals.map(i => {
            const powerType = i.powerType || (i.power !== undefined ? 'absolute' : 'relative');
            return {
                id: Date.now() + Math.random(),
                name: i.name,
                type: i.type,
                duration: i.duration,
                powerType: powerType,
                ...(powerType === 'absolute' ? { power: i.power } : { percentage: i.percentage || 100 })
            };
        });
        
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
            description: prompt('Workout description (optional):', '') || '',
            ftp: this.ftp,
            intervals: this.intervals.map(interval => {
                // Create clean interval object without UI-specific fields
                const cleanInterval = {
                    name: interval.name,
                    type: interval.type,
                    duration: interval.duration,
                    powerType: interval.powerType || 'relative'
                };
                
                // Add power fields based on type
                if (cleanInterval.powerType === 'absolute') {
                    cleanInterval.power = interval.power;
                } else {
                    cleanInterval.percentage = interval.percentage;
                }
                
                return cleanInterval;
            }),
            created: new Date().toISOString(),
            version: '1.0'
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

                // Validate workout structure
                if (!workout.intervals || !Array.isArray(workout.intervals)) {
                    throw new Error('Invalid workout format: missing or invalid intervals array');
                }

                // Validate and normalize each interval
                const validIntervals = workout.intervals.map((interval, index) => {
                    // Check required fields
                    if (!interval.duration || typeof interval.duration !== 'number') {
                        throw new Error(`Interval ${index + 1}: missing or invalid duration`);
                    }
                    
                    // Determine power type and validate
                    const powerType = interval.powerType || (interval.power !== undefined ? 'absolute' : 'relative');
                    
                    if (powerType === 'absolute') {
                        if (!interval.power || typeof interval.power !== 'number') {
                            throw new Error(`Interval ${index + 1}: missing or invalid power value for absolute power type`);
                        }
                    } else {
                        if (!interval.percentage || typeof interval.percentage !== 'number') {
                            throw new Error(`Interval ${index + 1}: missing or invalid percentage value for relative power type`);
                        }
                    }
                    
                    // Normalize interval with defaults
                    return {
                        id: Date.now() + Math.random(),
                        name: interval.name || `Interval ${index + 1}`,
                        type: interval.type || 'custom',
                        duration: interval.duration,
                        powerType: powerType,
                        ...(powerType === 'absolute' ? { power: interval.power } : { percentage: interval.percentage })
                    };
                });

                this.intervals = validIntervals;
                
                // Update FTP if provided
                if (workout.ftp && typeof workout.ftp === 'number') {
                    this.ftp = workout.ftp;
                    document.getElementById('ftpInput').value = this.ftp;
                }

                this.render();
                this.updateWorkoutInfo();
                
                // Auto-save imported workout to library
                const workoutName = workout.name || 'Imported Workout';
                this.saveWorkout(workoutName);
                
                this.ftms.log(`✓ Imported workout: ${workoutName} (${validIntervals.length} intervals)`, 'success');
                
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
