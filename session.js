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
        this.workoutStartTime = null;
        this.syncInterval = null;
    }

    // Generate a short, memorable session code
    generateSessionCode() {
        const adjectives = ['swift', 'power', 'turbo', 'epic', 'mega', 'super', 'ultra', 'hyper'];
        const nouns = ['rider', 'cycler', 'racer', 'pedal', 'wheel', 'chain', 'sprint', 'climb'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const num = Math.floor(Math.random() * 100);
        return `${adj}-${noun}-${num}`;
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
                this.sessionId = this.generateSessionCode();
                this.isHost = true;

                // Store session info
                const sessionInfo = {
                    sessionId: this.sessionId,
                    hostPeerId: id,
                    created: Date.now()
                };

                // Add self as participant
                this.participants.set(id, {
                    id,
                    name: userName,
                    power: 0,
                    cadence: 0,
                    progress: 0,
                    isHost: true,
                    connected: true
                });

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
    async joinSession(sessionId, userName) {
        return new Promise((resolve, reject) => {
            // First, we need to discover the host's peer ID
            // For simplicity, we'll encode it in the session code
            // Format: word-word-num-hostpeerid

            // For now, let's use a simple approach: prompt for host peer ID
            // In production, you'd want a signaling server

            const hostPeerId = prompt('Enter host Peer ID (provided by session host):');
            if (!hostPeerId) {
                reject(new Error('No host peer ID provided'));
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
                    this.sessionId = sessionId;
                    this.isHost = false;

                    // Send join message
                    conn.send({
                        type: 'join',
                        id,
                        name: userName
                    });

                    this.connections.set(hostPeerId, conn);
                    this.setupConnectionHandlers(conn, hostPeerId);

                    resolve({ sessionId, peerId: id });
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
                    isHost: false,
                    connected: true
                });

                // Send current participants list to new joiner
                if (this.isHost) {
                    const conn = this.connections.get(fromPeerId);
                    if (conn) {
                        conn.send({
                            type: 'participants',
                            participants: Array.from(this.participants.values())
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
                const participant = this.participants.get(data.id);
                if (participant) {
                    participant.power = data.power;
                    participant.cadence = data.cadence;
                    participant.progress = data.progress;

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
    }

    // Get session info for sharing
    getShareInfo() {
        if (!this.peer || !this.sessionId) return null;

        return {
            sessionId: this.sessionId,
            peerId: this.peer.id,
            url: `${window.location.origin}${window.location.pathname}?session=${this.sessionId}&host=${this.peer.id}`
        };
    }
}
