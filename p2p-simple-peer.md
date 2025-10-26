# Pure P2P with Simple-Peer + Cloudflare Signaling

## Architecture

```
1. Initial Connection (via Cloudflare Worker):
   Host ←→ CF Worker ←→ Participant

2. After WebRTC established:
   Host ←→ Participant (DIRECT P2P, no server!)
```

Cloudflare Worker is **only used once** to exchange WebRTC connection info. After that, all metrics/messages go directly peer-to-peer with **zero server involvement**.

## Why This is Better

✅ **True P2P**: Messages go directly between peers, no server relay
✅ **Reliable signaling**: Your own Cloudflare Worker instead of `0.peerjs.com`
✅ **Free**: Cloudflare free tier is generous
✅ **Simple**: `simple-peer` is smaller and simpler than PeerJS
✅ **Low latency**: Direct connection = faster than server relay

## Implementation

### 1. Cloudflare Worker (Just for Signaling)

**wrangler.toml**:
```toml
name = "zwift-signaling"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "SIGNALING_ROOM"
class_name = "SignalingRoom"

[[migrations]]
tag = "v1"
new_classes = ["SignalingRoom"]
```

**src/index.js**:
```javascript
export { SignalingRoom } from './SignalingRoom';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const match = url.pathname.match(/^\/signal\/(.+)$/);
    if (match && request.headers.get('Upgrade') === 'websocket') {
      const sessionId = match[1];
      const id = env.SIGNALING_ROOM.idFromName(sessionId);
      const stub = env.SIGNALING_ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response('Zwift Signaling Server', { headers: corsHeaders });
  }
};
```

**src/SignalingRoom.js**:
```javascript
export class SignalingRoom {
  constructor(state, env) {
    this.state = state;
    this.connections = new Map(); // peerId -> WebSocket
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    await this.handleConnection(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleConnection(ws) {
    ws.accept();
    const peerId = crypto.randomUUID();
    this.connections.set(peerId, ws);

    // Send peer their ID
    ws.send(JSON.stringify({ type: 'id', id: peerId }));

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);

        // Relay signaling messages to target peer
        if (data.target) {
          const targetWs = this.connections.get(data.target);
          if (targetWs) {
            targetWs.send(JSON.stringify({
              ...data,
              from: peerId
            }));
          }
        } else {
          // Broadcast to all except sender (for discovery)
          for (const [id, targetWs] of this.connections.entries()) {
            if (id !== peerId) {
              targetWs.send(JSON.stringify({
                ...data,
                from: peerId
              }));
            }
          }
        }
      } catch (err) {
        console.error('Signal error:', err);
      }
    });

    ws.addEventListener('close', () => {
      this.connections.delete(peerId);
      // Notify others
      this.broadcast({ type: 'peer-left', peerId });
    });
  }

  broadcast(message) {
    const msg = JSON.stringify(message);
    for (const ws of this.connections.values()) {
      try { ws.send(msg); } catch {}
    }
  }
}
```

### 2. Client-Side (session-p2p.js)

```javascript
import SimplePeer from 'simple-peer';

class P2PSessionManager {
  constructor() {
    this.sessionId = null;
    this.isHost = false;
    this.myPeerId = null;
    this.signalingWs = null;
    this.peers = new Map(); // peerId -> SimplePeer instance
    this.participants = new Map();
    this.onParticipantUpdate = null;
    this.onWorkoutReceived = null;
    this.onSessionStart = null;
  }

  async createSession(userName) {
    this.isHost = true;
    this.sessionId = this.generateSessionCode();
    await this.connectToSignaling();

    this.addSelfAsParticipant(userName);

    return {
      sessionId: this.sessionId,
      peerId: this.myPeerId
    };
  }

  async joinSession(sessionCode, userName) {
    this.isHost = false;
    this.sessionId = sessionCode;
    await this.connectToSignaling();

    this.addSelfAsParticipant(userName);

    // Request connection to host
    this.signalingWs.send(JSON.stringify({
      type: 'request-join',
      name: userName
    }));

    return {
      sessionId: this.sessionId,
      peerId: this.myPeerId
    };
  }

  async connectToSignaling() {
    const wsUrl = `wss://zwift-signaling.your-worker.workers.dev/signal/${this.sessionId}`;
    this.signalingWs = new WebSocket(wsUrl);

    return new Promise((resolve, reject) => {
      this.signalingWs.onopen = () => resolve();
      this.signalingWs.onerror = reject;

      this.signalingWs.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'id':
            // Got our peer ID from signaling server
            this.myPeerId = data.id;
            break;

          case 'request-join':
            // Someone wants to join (we are host)
            if (this.isHost) {
              this.createPeerConnection(data.from, true); // initiator
            }
            break;

          case 'signal':
            // WebRTC signaling data
            this.handleSignal(data.from, data.signal);
            break;

          case 'peer-left':
            this.removePeer(data.peerId);
            break;
        }
      };
    });
  }

  createPeerConnection(peerId, initiator) {
    if (this.peers.has(peerId)) return;

    const peer = new SimplePeer({
      initiator,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    // Send signaling data via signaling server
    peer.on('signal', (signal) => {
      this.signalingWs.send(JSON.stringify({
        type: 'signal',
        target: peerId,
        signal
      }));
    });

    // P2P connection established! 🎉
    peer.on('connect', () => {
      console.log('P2P connection established with', peerId);
      // Now all messages go directly peer-to-peer!
    });

    // Receive data via P2P (NO SERVER!)
    peer.on('data', (data) => {
      this.handleP2PMessage(peerId, JSON.parse(data.toString()));
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      this.removePeer(peerId);
    });

    peer.on('close', () => {
      this.removePeer(peerId);
    });

    this.peers.set(peerId, peer);
  }

  handleSignal(fromPeerId, signal) {
    let peer = this.peers.get(fromPeerId);

    if (!peer) {
      // Create peer connection (not initiator)
      this.createPeerConnection(fromPeerId, false);
      peer = this.peers.get(fromPeerId);
    }

    peer.signal(signal);
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

          if (this.onParticipantUpdate) {
            this.onParticipantUpdate(Array.from(this.participants.values()));
          }
        }
        break;

      case 'workout':
        if (this.onWorkoutReceived) {
          this.onWorkoutReceived(data.workout);
        }
        break;

      case 'start-countdown':
        if (this.onSessionStart) {
          this.onSessionStart(data.startTime);
        }
        break;
    }
  }

  // Send data via P2P (direct connection, no server!)
  sendToAll(message) {
    const data = JSON.stringify(message);
    for (const peer of this.peers.values()) {
      if (peer.connected) {
        peer.send(data);
      }
    }
  }

  broadcastMetrics(power, cadence, progress, heartRate) {
    this.sendToAll({
      type: 'metrics',
      power,
      cadence,
      heartRate,
      progress
    });
  }

  shareWorkout(workout) {
    this.sendToAll({
      type: 'workout',
      workout
    });
  }

  startSynchronizedWorkout(countdownSeconds) {
    const startTime = Date.now() + (countdownSeconds * 1000);
    this.sendToAll({
      type: 'start-countdown',
      startTime
    });
  }

  generateSessionCode() {
    const words = ['swift', 'power', 'turbo', 'epic'];
    const word = words[Math.floor(Math.random() * words.length)];
    const num = Math.floor(Math.random() * 1000);
    return `${word}-${num}`;
  }

  addSelfAsParticipant(userName) {
    this.participants.set(this.myPeerId, {
      id: this.myPeerId,
      name: userName,
      power: 0,
      cadence: 0,
      heartRate: 0,
      progress: 0,
      ftp: 200,
      isHost: this.isHost
    });
  }

  removePeer(peerId) {
    this.peers.delete(peerId);
    this.participants.delete(peerId);

    if (this.onParticipantUpdate) {
      this.onParticipantUpdate(Array.from(this.participants.values()));
    }
  }

  disconnect() {
    for (const peer of this.peers.values()) {
      peer.destroy();
    }
    this.peers.clear();

    if (this.signalingWs) {
      this.signalingWs.close();
    }
  }
}

export default P2PSessionManager;
```

### 3. HTML (add simple-peer)

```html
<script src="https://cdn.jsdelivr.net/npm/simple-peer@9.11.1/simplepeer.min.js"></script>
```

## How It Works

1. **User creates session** → Connects to Cloudflare Worker signaling server
2. **Friend joins** → Also connects to signaling server
3. **Signaling server exchanges WebRTC offers/answers** (just once!)
4. **P2P connection established** → Direct connection between peers
5. **Signaling server no longer needed** → All metrics go P2P directly
6. **Send metrics** → `peer.send(data)` goes DIRECTLY to other peer, no server!

## Cost Analysis

- **Signaling**: ~10 messages per connection = 100 requests
- **Metrics**: 0 server requests (P2P!)
- **1000 users**: ~100k signaling requests = FREE on Cloudflare

## Migration from PeerJS

Replace `session.js` with `session-p2p.js` - same API, better reliability!

## Why This is Perfect for You

✅ **True P2P**: Metrics go directly peer-to-peer
✅ **Minimal server use**: Signaling server only for initial connection
✅ **Free**: Cloudflare free tier is enough
✅ **Reliable**: You control the signaling server
✅ **Low latency**: Direct P2P = no server hop

Want me to implement this?
