// P2P Session Manager using SimplePeer + Cloudflare Signaling
// After initial connection, all messages go DIRECT peer-to-peer (no server!)

class P2PSessionManager {
    constructor() {
        this.sessionId = null;
        this.isHost = false;
        this.myPeerId = null;
        this.signalingWs = null;
        this.peers = new Map(); // peerId -> SimplePeer instance
        this.participants = new Map();
        this.userName = null;
        this.sharedWorkout = null;

        // Callbacks
        this.onParticipantUpdate = null;
        this.onWorkoutReceived = null;
        this.onSessionStart = null;
        this.onSessionEnd = null;

        // Cloudflare Worker URL
        this.signalingUrl = 'wss://zwift-signaling.w-vollprecht.workers.dev';
    }

    async createSession(userName) {
        this.isHost = true;
        this.userName = userName;
        this.sessionId = this.generateSessionCode();

        await this.connectToSignaling();

        // Save session state for persistence
        this.saveSessionState();

        return {
            sessionId: this.sessionId,
            peerId: this.myPeerId
        };
    }

    async joinSession(sessionCode, userName) {
        this.isHost = false;
        this.userName = userName;
        this.sessionId = sessionCode;

        await this.connectToSignaling();

        // Save session state for persistence
        this.saveSessionState();

        return {
            sessionId: this.sessionId,
            peerId: this.myPeerId
        };
    }

    async connectToSignaling() {
        const wsUrl = `${this.signalingUrl}/signal/${this.sessionId}`;
        console.log('Connecting to signaling server:', wsUrl);

        this.signalingWs = new WebSocket(wsUrl);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Signaling server connection timeout'));
            }, 10000);

            this.signalingWs.onopen = () => {
                console.log('Connected to signaling server');
                clearTimeout(timeout);
            };

            this.signalingWs.onerror = (err) => {
                console.error('Signaling WebSocket error:', err);
                clearTimeout(timeout);
                reject(new Error('Failed to connect to signaling server'));
            };

            this.signalingWs.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleSignalingMessage(data, resolve);
                } catch (err) {
                    console.error('Error parsing signaling message:', err);
                }
            };

            this.signalingWs.onclose = () => {
                console.log('Signaling connection closed');
            };
        });
    }

    handleSignalingMessage(data, resolveConnection) {
        console.log('Signaling message:', data.type);

        switch (data.type) {
            case 'id':
                // Got our peer ID from signaling server
                this.myPeerId = data.id;
                this.isHost = data.isHost;
                console.log('My peer ID:', this.myPeerId, 'isHost:', this.isHost);

                // Add self as participant
                this.participants.set(this.myPeerId, {
                    id: this.myPeerId,
                    name: this.userName,
                    power: 0,
                    cadence: 0,
                    heartRate: 0,
                    progress: 0,
                    ftp: 200,
                    isHost: this.isHost
                });

                // Announce ourselves
                this.sendToSignaling({
                    type: 'join',
                    name: this.userName,
                    ftp: 200
                });

                if (resolveConnection) {
                    resolveConnection();
                }
                break;

            case 'existing-peers':
                // Add existing peers to our list
                data.peers.forEach(peer => {
                    if (peer.id !== this.myPeerId) {
                        this.participants.set(peer.id, {
                            id: peer.id,
                            name: peer.name,
                            power: 0,
                            cadence: 0,
                            heartRate: 0,
                            progress: 0,
                            ftp: peer.ftp || 200,
                            isHost: false
                        });
                    }
                });
                this.updateParticipants();
                break;

            case 'peer-joined':
                // New peer joined - create P2P connection if we're host
                console.log('Peer joined:', data.peerId, data.name);

                this.participants.set(data.peerId, {
                    id: data.peerId,
                    name: data.name,
                    power: 0,
                    cadence: 0,
                    heartRate: 0,
                    progress: 0,
                    ftp: data.ftp || 200,
                    isHost: data.isHost
                });

                // If we're host, initiate P2P connection
                if (this.isHost) {
                    this.createPeerConnection(data.peerId, true);
                }

                this.updateParticipants();
                break;

            case 'peer-left':
                console.log('Peer left:', data.peerId);
                this.removePeer(data.peerId);
                break;

            case 'signal':
                // WebRTC signaling data from another peer
                this.handleSignal(data.from, data.signal);
                break;

            case 'request-join':
                // Someone wants to join (we are host)
                console.log('Join request from:', data.from, data.name);
                if (this.isHost) {
                    this.createPeerConnection(data.from, true);
                }
                break;
        }
    }

    createPeerConnection(peerId, initiator) {
        if (this.peers.has(peerId)) {
            console.log('Peer connection already exists for', peerId);
            return;
        }

        console.log('Creating P2P connection with', peerId, 'initiator:', initiator);

        const peer = new SimplePeer({
            initiator,
            trickle: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            }
        });

        // Send WebRTC signaling data via signaling server
        peer.on('signal', (signal) => {
            console.log('Sending signal to', peerId);
            this.sendToSignaling({
                type: 'signal',
                target: peerId,
                signal: signal
            });
        });

        // P2P connection established! 🎉
        peer.on('connect', () => {
            console.log('✅ P2P connection established with', peerId);
            // Share current workout if host
            if (this.isHost && this.sharedWorkout) {
                this.sendToPeer(peerId, {
                    type: 'workout',
                    workout: this.sharedWorkout
                });
            }
        });

        // Receive data via P2P (NO SERVER!)
        peer.on('data', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleP2PMessage(peerId, message);
            } catch (err) {
                console.error('Error parsing P2P message:', err);
            }
        });

        peer.on('error', (err) => {
            console.error('Peer error with', peerId, ':', err);
        });

        peer.on('close', () => {
            console.log('P2P connection closed with', peerId);
            this.removePeer(peerId);
        });

        this.peers.set(peerId, peer);
    }

    handleSignal(fromPeerId, signal) {
        let peer = this.peers.get(fromPeerId);

        if (!peer) {
            // Create peer connection (not initiator since we're receiving signal)
            this.createPeerConnection(fromPeerId, false);
            peer = this.peers.get(fromPeerId);
        }

        if (peer) {
            peer.signal(signal);
        }
    }

    handleP2PMessage(fromPeerId, data) {
        // Handle messages received via direct P2P connection
        switch (data.type) {
            case 'metrics':
                const participant = this.participants.get(fromPeerId);
                if (participant) {
                    participant.power = data.power;
                    participant.cadence = data.cadence;
                    participant.heartRate = data.heartRate;
                    participant.progress = data.progress;
                    this.updateParticipants();
                }

                // If host, relay to other participants
                if (this.isHost) {
                    this.broadcast(data, fromPeerId);
                }
                break;

            case 'workout':
                this.sharedWorkout = data.workout;
                if (this.onWorkoutReceived) {
                    this.onWorkoutReceived(data.workout);
                }
                break;

            case 'start-countdown':
                if (this.onSessionStart) {
                    this.onSessionStart(data.startTime);
                }
                break;

            case 'ftp-update':
                const ftpParticipant = this.participants.get(fromPeerId);
                if (ftpParticipant) {
                    ftpParticipant.ftp = data.ftp;
                    this.updateParticipants();
                }

                // If host, relay to other participants
                if (this.isHost) {
                    this.broadcast(data, fromPeerId);
                }
                break;

            case 'end-workout':
                if (this.onSessionEnd) {
                    this.onSessionEnd();
                }
                break;
        }
    }

    sendToSignaling(message) {
        if (this.signalingWs && this.signalingWs.readyState === WebSocket.OPEN) {
            this.signalingWs.send(JSON.stringify(message));
        }
    }

    sendToPeer(peerId, message) {
        const peer = this.peers.get(peerId);
        if (peer && peer.connected) {
            peer.send(JSON.stringify(message));
        }
    }

    // Send to all connected peers via P2P (no server!)
    broadcast(message, excludePeerId = null) {
        for (const [peerId, peer] of this.peers.entries()) {
            if (peerId !== excludePeerId && peer.connected) {
                peer.send(JSON.stringify(message));
            }
        }
    }

    broadcastMetrics(power, cadence, progress, heartRate) {
        // Update own participant data
        const self = this.participants.get(this.myPeerId);
        if (self) {
            self.power = power;
            self.cadence = cadence;
            self.heartRate = heartRate;
            self.progress = progress;
        }

        // Broadcast to all peers via P2P
        this.broadcast({
            type: 'metrics',
            power,
            cadence,
            heartRate,
            progress
        });
    }

    updateFTP(ftp) {
        const self = this.participants.get(this.myPeerId);
        if (self) {
            self.ftp = ftp;
        }

        this.broadcast({
            type: 'ftp-update',
            ftp
        });
    }

    shareWorkout(workout) {
        this.sharedWorkout = workout;
        this.broadcast({
            type: 'workout',
            workout
        });
    }

    startSynchronizedWorkout(countdownSeconds) {
        const startTime = Date.now() + (countdownSeconds * 1000);
        this.broadcast({
            type: 'start-countdown',
            startTime
        });
    }

    endWorkout() {
        this.broadcast({
            type: 'end-workout'
        });
    }

    updateParticipants() {
        if (this.onParticipantUpdate) {
            this.onParticipantUpdate(Array.from(this.participants.values()));
        }
    }

    generateSessionCode() {
        // Generate memorable but secure session code
        // Format: adjective-noun-verb-animal (e.g., "swift-mountain-climbing-falcon")
        // ~1.5 million combinations - secure enough for temporary sessions

        const adjectives = [
            'swift', 'strong', 'brave', 'mighty', 'rapid', 'blazing', 'fierce', 'bold',
            'turbo', 'power', 'epic', 'mega', 'super', 'ultra', 'stellar', 'cosmic',
            'thunder', 'lightning', 'storm', 'wild', 'golden', 'silver', 'crimson', 'azure'
        ];

        const nouns = [
            'mountain', 'valley', 'river', 'peak', 'summit', 'ridge', 'canyon', 'plateau',
            'rider', 'cycler', 'racer', 'climber', 'sprinter', 'champion', 'legend', 'hero',
            'wheel', 'pedal', 'chain', 'spoke', 'saddle', 'handle', 'frame', 'gear'
        ];

        const verbs = [
            'riding', 'climbing', 'sprinting', 'racing', 'crushing', 'dominating', 'flying', 'soaring',
            'blazing', 'rolling', 'spinning', 'pushing', 'grinding', 'attacking', 'charging', 'surging'
        ];

        const animals = [
            'falcon', 'eagle', 'hawk', 'cheetah', 'leopard', 'jaguar', 'panther', 'tiger',
            'lion', 'wolf', 'bear', 'shark', 'dragon', 'phoenix', 'griffin', 'mustang',
            'stallion', 'gazelle', 'cobra', 'viper', 'raptor', 'condor', 'raven', 'owl'
        ];

        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const animal = animals[Math.floor(Math.random() * animals.length)];

        return `${adj}-${noun}-${verb}-${animal}`;
    }

    removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.destroy();
            this.peers.delete(peerId);
        }

        this.participants.delete(peerId);
        this.updateParticipants();
    }

    disconnect() {
        console.log('Disconnecting from session');

        // Close all P2P connections
        for (const peer of this.peers.values()) {
            peer.destroy();
        }
        this.peers.clear();

        // Close signaling connection
        if (this.signalingWs) {
            this.signalingWs.close();
            this.signalingWs = null;
        }

        this.participants.clear();
        this.sessionId = null;
        this.myPeerId = null;

        // Clear persisted session state
        this.clearSessionState();
    }

    getShareInfo() {
        if (!this.sessionId) return null;
        return {
            sessionId: this.sessionId,
            peerId: this.myPeerId
        };
    }

    // Session persistence (localStorage)
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

    loadSessionState() {
        const stored = localStorage.getItem('zwift_session_state');
        if (!stored) return null;

        try {
            const state = JSON.parse(stored);
            const age = Date.now() - state.createdAt;
            if (age > 24 * 60 * 60 * 1000) {
                this.clearSessionState();
                return null;
            }
            return state;
        } catch (err) {
            return null;
        }
    }

    clearSessionState() {
        localStorage.removeItem('zwift_session_state');
    }

    async restoreSession() {
        const state = this.loadSessionState();
        if (!state) return null;

        try {
            if (state.isHost) {
                return await this.createSession(state.userName);
            } else {
                return await this.joinSession(state.sessionId, state.userName);
            }
        } catch (err) {
            this.clearSessionState();
            return null;
        }
    }
}
