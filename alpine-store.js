const HR_ZONE_COLOR_DEFAULT = '#666666';
const HR_ZONE_BACKGROUNDS = {
    0: 'rgba(100, 116, 139, 0.12)',
    1: 'rgba(74, 222, 128, 0.16)',
    2: 'rgba(34, 211, 238, 0.16)',
    3: 'rgba(251, 191, 36, 0.16)',
    4: 'rgba(251, 146, 60, 0.16)',
    5: 'rgba(239, 68, 68, 0.16)'
};

const HR_ZONE_BORDERS = {
    0: 'rgba(100, 116, 139, 0.35)',
    1: 'rgba(74, 222, 128, 0.55)',
    2: 'rgba(34, 211, 238, 0.55)',
    3: 'rgba(251, 191, 36, 0.55)',
    4: 'rgba(251, 146, 60, 0.55)',
    5: 'rgba(239, 68, 68, 0.55)'
};

// Alpine.js Global Store for Zwift Hub Controller
document.addEventListener('alpine:init', () => {
    Alpine.store('app', {
        // Connection state
        connected: false,
        connecting: false,
        deviceName: null,

        // HRM connection state
        hrmConnected: false,
        hrmConnecting: false,
        hrmDeviceName: null,
        hasTrainerHR: false,  // Whether the trainer provides HR data

        // Metrics (flattened for better reactivity)
        power: 0,
        cadence: 0,
        heartRate: 0,
        heartRateZone: 0,
        heartRateColor: HR_ZONE_COLOR_DEFAULT,
        heartRateBackground: HR_ZONE_BACKGROUNDS[0],
        heartRateBorder: HR_ZONE_BORDERS[0],
        heartRateZoneName: 'No Data',
        targetPower: '--',
        status: '--',

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

        setHRMConnected(connected, deviceName = null) {
            this.hrmConnected = connected;
            this.hrmConnecting = false;
            this.hrmDeviceName = deviceName;
        },

        setHRMConnecting(connecting) {
            this.hrmConnecting = connecting;
        },

        setHasTrainerHR(hasHR) {
            this.hasTrainerHR = hasHR;
        },

        updateMetrics(metrics) {
            this.power = Math.max(0, metrics.power || 0);
            this.cadence = Math.max(0, metrics.cadence || 0);
            const hr = Math.max(0, Number(metrics.hr ?? metrics.heartRate ?? 0) || 0);
            this.heartRate = hr;
            this.applyHeartRateStyling(hr);
        },

        applyHeartRateStyling(hr = 0) {
            const hasHRZones = typeof window !== 'undefined' && window.HRZones;
            const normalizedHR = Math.max(0, Number(hr) || 0);
            const zone = hasHRZones && normalizedHR > 0 ? HRZones.getZone(normalizedHR) : 0;

            this.heartRateZone = zone;
            this.heartRateColor = hasHRZones ? HRZones.getZoneColor(zone) : HR_ZONE_COLOR_DEFAULT;
            this.heartRateZoneName = zone > 0 && hasHRZones ? HRZones.getZoneName(zone) : 'No Data';
            this.heartRateBackground = HR_ZONE_BACKGROUNDS[zone] || HR_ZONE_BACKGROUNDS[0];
            this.heartRateBorder = HR_ZONE_BORDERS[zone] || HR_ZONE_BORDERS[0];
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
            const hasHRZones = typeof window !== 'undefined' && window.HRZones;

            this.session.participants = (participants || []).map((participant) => {
                const hr = Math.max(0, Number(participant.heartRate || 0));
                const zone = hasHRZones && hr > 0 ? HRZones.getZone(hr) : 0;
                const color = hasHRZones ? HRZones.getZoneColor(zone) : HR_ZONE_COLOR_DEFAULT;

                return {
                    ...participant,
                    hrZone: zone,
                    hrColor: color,
                    hrBackground: HR_ZONE_BACKGROUNDS[zone] || HR_ZONE_BACKGROUNDS[0],
                    hrBorder: HR_ZONE_BORDERS[zone] || HR_ZONE_BORDERS[0],
                    zoneLabel: zone > 0 ? `Z${zone}` : '',
                    isSelf: Boolean(participant.isSelf)
                };
            });
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
