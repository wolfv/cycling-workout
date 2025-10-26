// Collaborative Session Manager using PeerJS
class SessionManager {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // Map of peerId -> connection
        this.sessionId = null;
        this.isHost = false;
        this.participants = new Map(); // Map of peerId -> participant data
        this.onParticipantUpdate = null;
        this.onSessionStart = null;
        this.onSessionEnd = null;
        this.onWorkoutReceived = null;
        this.workoutStartTime = null;
        this.syncInterval = null;
        this.sharedWorkout = null; // The workout intervals shared by host
        this.userName = null;
    }

    // Save session state to localStorage
    saveSessionState() {
        const state = {
            sessionId: this.sessionId,
            isHost: this.isHost,
            userName: this.userName,
            createdAt: Date.now(),
            workout: this.sharedWorkout
        };
        localStorage.setItem('zwift_session_state', JSON.stringify(state));
    }

    // Load session state from localStorage
    loadSessionState() {
        const stored = localStorage.getItem('zwift_session_state');
        if (!stored) return null;

        try {
            const state = JSON.parse(stored);

            // Check if session is too old (> 24 hours)
            const age = Date.now() - state.createdAt;
            if (age > 24 * 60 * 60 * 1000) {
                this.clearSessionState();
                return null;
            }

            return state;
        } catch (err) {
            console.error('Failed to load session state:', err);
            return null;
        }
    }

    // Clear session state from localStorage
    clearSessionState() {
        localStorage.removeItem('zwift_session_state');
    }

    // Attempt to restore session from localStorage
    async restoreSession() {
        const state = this.loadSessionState();
        if (!state) return null;

        console.log('Attempting to restore session:', state.sessionId);

        try {
            if (state.isHost) {
                // Restore as host
                return await this.createSession(state.userName);
            } else {
                // Restore as participant - rejoin
                return await this.joinSession(state.sessionId, state.userName);
            }
        } catch (err) {
            console.error('Failed to restore session:', err);
            this.clearSessionState();
            return null;
        }
    }

    // Generate a short, memorable session code with encoded peer ID
    generateSessionCode(peerId) {
        const adjectives = ['swift', 'power', 'turbo', 'epic', 'mega', 'super', 'ultra', 'hyper'];
        const nouns = ['rider', 'cycler', 'racer', 'pedal', 'wheel', 'chain', 'sprint', 'climb'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const num = Math.floor(Math.random() * 100);

        // Encode peer ID as base64 and append
        const encodedPeerId = btoa(peerId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        return `${adj}-${noun}-${num}-${encodedPeerId}`;
    }

    // Decode host peer ID from session code
    decodeSessionCode(sessionCode) {
        const parts = sessionCode.split('-');
        if (parts.length < 4) {
            throw new Error('Invalid session code format');
        }

        // Last part is the encoded peer ID
        const encodedPeerId = parts[parts.length - 1];
        const base64 = encodedPeerId.replace(/-/g, '+').replace(/_/g, '/');

        try {
            const hostPeerId = atob(base64);
            const sessionId = parts.slice(0, 3).join('-'); // e.g., "swift-rider-42"
            return { hostPeerId, sessionId };
        } catch (err) {
            throw new Error('Invalid session code: could not decode peer ID');
        }
    }

    // Create a new session (host)
    async createSession(userName) {
        return new Promise((resolve, reject) => {
            // Generate unique peer ID
            const peerId = `zwift-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            this.peer = new Peer(peerId, {
                debug: 0,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ]
                }
            });

            this.peer.on('open', (id) => {
                this.sessionId = this.generateSessionCode(id);
                this.isHost = true;
                this.hostPeerId = id;
                this.userName = userName;

                // Add self as participant
                this.participants.set(id, {
                    id,
                    name: userName,
                    power: 0,
                    cadence: 0,
                    progress: 0,
                    ftp: 200, // Default FTP
                    isHost: true,
                    connected: true
                });

                // Save session state
                this.saveSessionState();

                console.log('Session created:', this.sessionId, 'PeerID:', id);
                resolve({ sessionId: this.sessionId, peerId: id });
            });

            this.peer.on('connection', (conn) => {
                this.handleIncomingConnection(conn);
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);
                reject(err);
            });
        });
    }

    // Join an existing session
    async joinSession(sessionCode, userName) {
        return new Promise((resolve, reject) => {
            // Decode the session code to extract host peer ID
            let hostPeerId, sessionId;
            try {
                const decoded = this.decodeSessionCode(sessionCode);
                hostPeerId = decoded.hostPeerId;
                sessionId = decoded.sessionId;
            } catch (err) {
                reject(err);
                return;
            }

            const peerId = `zwift-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            this.peer = new Peer(peerId, {
                debug: 0,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ]
                }
            });

            this.peer.on('open', (id) => {
                console.log('Connecting to host:', hostPeerId);

                // Connect to host
                const conn = this.peer.connect(hostPeerId, {
                    reliable: true,
                    serialization: 'json'
                });

                conn.on('open', () => {
                    console.log('Connected to host');
                    this.sessionId = sessionCode; // Store full session code
                    this.isHost = false;
                    this.hostPeerId = hostPeerId;
                    this.userName = userName;

                    // Send join message with FTP
                    conn.send({
                        type: 'join',
                        id,
                        name: userName,
                        ftp: 200 // Default FTP, will be updated by user
                    });

                    this.connections.set(hostPeerId, conn);
                    this.setupConnectionHandlers(conn, hostPeerId);

                    // Save session state
                    this.saveSessionState();

                    resolve({ sessionId: sessionCode, peerId: id });
                });

                conn.on('error', (err) => {
                    console.error('Connection error:', err);
                    reject(err);
                });
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);
                reject(err);
            });
        });
    }

    handleIncomingConnection(conn) {
        console.log('Incoming connection from:', conn.peer);

        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            this.setupConnectionHandlers(conn, conn.peer);
        });
    }

    setupConnectionHandlers(conn, peerId) {
        conn.on('data', (data) => {
            this.handleMessage(data, peerId);
        });

        conn.on('close', () => {
            console.log('Connection closed:', peerId);
            this.connections.delete(peerId);
            this.participants.delete(peerId);
            if (this.onParticipantUpdate) {
                this.onParticipantUpdate(Array.from(this.participants.values()));
            }
        });

        conn.on('error', (err) => {
            console.error('Connection error:', peerId, err);
        });
    }

    handleMessage(data, fromPeerId) {
        switch (data.type) {
            case 'join':
                // New participant joined
                this.participants.set(data.id, {
                    id: data.id,
                    name: data.name,
                    power: 0,
                    cadence: 0,
                    progress: 0,
                    ftp: data.ftp || 200,
                    isHost: false,
                    connected: true
                });

                // Send current participants list to new joiner
                if (this.isHost) {
                    const conn = this.connections.get(fromPeerId);
                    if (conn) {
                        // Send participants and workout
                        conn.send({
                            type: 'session-info',
                            participants: Array.from(this.participants.values()),
                            workout: this.sharedWorkout
                        });
                    }

                    // Broadcast to all other participants
                    this.broadcast({
                        type: 'participant-joined',
                        participant: this.participants.get(data.id)
                    }, fromPeerId);
                }

                if (this.onParticipantUpdate) {
                    this.onParticipantUpdate(Array.from(this.participants.values()));
                }
                break;

            case 'session-info':
                // Received session info from host (participants + workout)
                data.participants.forEach(p => {
                    this.participants.set(p.id, p);
                });

                if (data.workout) {
                    this.sharedWorkout = data.workout;
                    if (this.onWorkoutReceived) {
                        this.onWorkoutReceived(data.workout);
                    }
                }

                if (this.onParticipantUpdate) {
                    this.onParticipantUpdate(Array.from(this.participants.values()));
                }
                break;

            case 'workout-update':
                // Host updated the workout
                this.sharedWorkout = data.workout;
                if (this.onWorkoutReceived) {
                    this.onWorkoutReceived(data.workout);
                }
                break;

            case 'ftp-update':
                // Participant updated their FTP
                const ftpParticipant = this.participants.get(data.id);
                if (ftpParticipant) {
                    ftpParticipant.ftp = data.ftp;

                    if (this.onParticipantUpdate) {
                        this.onParticipantUpdate(Array.from(this.participants.values()));
                    }
                }

                // If host, relay to other participants
                if (this.isHost) {
                    this.broadcast(data, fromPeerId);
                }
                break;

            case 'participants':
                // Received full participants list from host
                data.participants.forEach(p => {
                    this.participants.set(p.id, p);
                });
                if (this.onParticipantUpdate) {
                    this.onParticipantUpdate(Array.from(this.participants.values()));
                }
                break;

            case 'participant-joined':
                this.participants.set(data.participant.id, data.participant);
                if (this.onParticipantUpdate) {
                    this.onParticipantUpdate(Array.from(this.participants.values()));
                }
                break;

            case 'metrics':
                // Update participant metrics
                const metricsParticipant = this.participants.get(data.id);
                if (metricsParticipant) {
                    metricsParticipant.power = data.power;
                    metricsParticipant.cadence = data.cadence;
                    metricsParticipant.progress = data.progress;

                    if (this.onParticipantUpdate) {
                        this.onParticipantUpdate(Array.from(this.participants.values()));
                    }
                }

                // If host, relay to other participants
                if (this.isHost) {
                    this.broadcast(data, fromPeerId);
                }
                break;

            case 'start-countdown':
                // Host is starting countdown
                if (this.onSessionStart) {
                    this.onSessionStart(data.startTime);
                }
                break;

            case 'end-workout':
                // Host ended the workout
                if (this.onSessionEnd) {
                    this.onSessionEnd();
                }
                break;
        }
    }

    // Broadcast metrics to all participants
    broadcastMetrics(power, cadence, progress) {
        if (!this.peer || !this.peer.id) return;

        const message = {
            type: 'metrics',
            id: this.peer.id,
            power,
            cadence,
            progress
        };

        // Update own participant data
        const self = this.participants.get(this.peer.id);
        if (self) {
            self.power = power;
            self.cadence = cadence;
            self.progress = progress;
        }

        // Broadcast to all connections
        this.broadcast(message);
    }

    // Start synchronized workout
    startSynchronizedWorkout(delaySeconds = 5) {
        if (!this.isHost) return;

        const startTime = Date.now() + (delaySeconds * 1000);
        this.workoutStartTime = startTime;

        this.broadcast({
            type: 'start-countdown',
            startTime
        });

        if (this.onSessionStart) {
            this.onSessionStart(startTime);
        }
    }

    // End workout for all participants
    endWorkout() {
        if (!this.isHost) return;

        this.broadcast({
            type: 'end-workout'
        });

        if (this.onSessionEnd) {
            this.onSessionEnd();
        }
    }

    // Share workout with all participants (host only)
    shareWorkout(workout) {
        if (!this.isHost) return;

        this.sharedWorkout = workout;

        this.broadcast({
            type: 'workout-update',
            workout
        });
    }

    // Update own FTP and broadcast to others
    updateFTP(ftp) {
        if (!this.peer || !this.peer.id) return;

        // Update own participant data
        const self = this.participants.get(this.peer.id);
        if (self) {
            self.ftp = ftp;
        }

        // Broadcast to all participants
        this.broadcast({
            type: 'ftp-update',
            id: this.peer.id,
            ftp
        });

        if (this.onParticipantUpdate) {
            this.onParticipantUpdate(Array.from(this.participants.values()));
        }
    }

    // Broadcast message to all connections (except exclude)
    broadcast(message, excludePeerId = null) {
        this.connections.forEach((conn, peerId) => {
            if (peerId !== excludePeerId && conn.open) {
                try {
                    conn.send(message);
                } catch (err) {
                    console.error('Failed to send to', peerId, err);
                }
            }
        });
    }

    // Leave session
    disconnect() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }

        this.connections.forEach(conn => {
            conn.close();
        });
        this.connections.clear();

        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }

        this.participants.clear();
        this.sessionId = null;
        this.isHost = false;
        this.userName = null;

        // Clear persisted session state
        this.clearSessionState();
    }

    // Get session info for sharing
    getShareInfo() {
        if (!this.peer || !this.sessionId) return null;

        return {
            sessionId: this.sessionId,
            peerId: this.peer.id
        };
    }
}
