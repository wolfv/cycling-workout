// Alpine.js Global Store for Zwift Hub Controller
document.addEventListener('alpine:init', () => {
    Alpine.store('app', {
        // Connection state
        connected: false,
        connecting: false,
        deviceName: null,

        // Metrics
        metrics: {
            power: 0,
            cadence: 0,
            heartRate: 0,
            targetPower: '--',
            status: '--'
        },

        // Session state
        session: {
            active: false,
            sessionId: null,
            isHost: false,
            participants: [],
            riderName: 'Rider'
        },

        // Workout state
        workout: {
            active: false,
            name: null,
            progress: 0,
            timeElapsed: 0,
            timeTotal: 0
        },

        // UI state
        ui: {
            currentTab: 'ride',
            targetPower: 100
        },

        // Methods
        setConnected(connected, deviceName = null) {
            this.connected = connected;
            this.connecting = false;
            this.deviceName = deviceName;
        },

        setConnecting(connecting) {
            this.connecting = connecting;
        },

        updateMetric(key, value) {
            this.metrics[key] = value;
        },

        setSession(sessionId, isHost, riderName) {
            this.session.active = true;
            this.session.sessionId = sessionId;
            this.session.isHost = isHost;
            this.session.riderName = riderName;
        },

        clearSession() {
            this.session.active = false;
            this.session.sessionId = null;
            this.session.isHost = false;
            this.session.participants = [];
        },

        updateParticipants(participants) {
            this.session.participants = participants;
        },

        setWorkout(name, timeTotal) {
            this.workout.active = true;
            this.workout.name = name;
            this.workout.timeTotal = timeTotal;
            this.workout.timeElapsed = 0;
            this.workout.progress = 0;
        },

        updateWorkoutProgress(timeElapsed, progress) {
            this.workout.timeElapsed = timeElapsed;
            this.workout.progress = progress;
        },

        clearWorkout() {
            this.workout.active = false;
            this.workout.name = null;
            this.workout.progress = 0;
            this.workout.timeElapsed = 0;
        },

        switchTab(tab) {
            this.ui.currentTab = tab;
        },

        setTargetPower(power) {
            this.ui.targetPower = power;
        },

        // Computed properties
        get connectionStatus() {
            if (this.connecting) return 'Connecting...';
            if (this.connected) return 'Connected';
            return 'Disconnected';
        },

        get riderCount() {
            return this.session.participants.length;
        },

        get workoutTimeFormatted() {
            const elapsed = Math.floor(this.workout.timeElapsed);
            const total = Math.floor(this.workout.timeTotal);
            const formatTime = (seconds) => {
                const mins = Math.floor(seconds / 60);
                const secs = seconds % 60;
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            };
            return `${formatTime(elapsed)} / ${formatTime(total)}`;
        }
    });
});
