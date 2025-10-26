// Durable Object for managing a single session's signaling
// One instance per session ID - handles WebRTC signaling between peers

export class SignalingRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Map(); // peerId -> { ws: WebSocket, joinedAt: timestamp }
    this.peerMetadata = new Map(); // peerId -> { name, isHost, etc. }
  }

  async fetch(request) {
    // Accept WebSocket upgrade
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Handle the WebSocket connection
    await this.handleConnection(server);

    // Return the client WebSocket to the browser
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleConnection(ws) {
    // Accept the WebSocket connection
    ws.accept();

    // Generate unique peer ID
    const peerId = crypto.randomUUID();
    const joinedAt = Date.now();

    // Determine if this peer is the host (first to join)
    const isHost = this.connections.size === 0;

    // Store connection
    this.connections.set(peerId, { ws, joinedAt });

    console.log(`Peer ${peerId} connected (isHost: ${isHost}). Total peers: ${this.connections.size}`);

    // Send peer their ID and host status
    this.sendToPeer(peerId, {
      type: 'id',
      id: peerId,
      isHost: isHost
    });

    // Notify peer about existing peers
    const existingPeers = Array.from(this.peerMetadata.entries()).map(([id, meta]) => ({
      id,
      ...meta
    }));

    if (existingPeers.length > 0) {
      this.sendToPeer(peerId, {
        type: 'existing-peers',
        peers: existingPeers
      });
    }

    // Handle incoming messages
    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(peerId, data);
      } catch (err) {
        console.error(`Error handling message from ${peerId}:`, err);
        this.sendToPeer(peerId, {
          type: 'error',
          message: 'Invalid message format'
        });
      }
    });

    // Handle disconnection
    ws.addEventListener('close', () => {
      console.log(`Peer ${peerId} disconnected`);
      this.connections.delete(peerId);
      this.peerMetadata.delete(peerId);

      // Notify all remaining peers
      this.broadcast({
        type: 'peer-left',
        peerId: peerId
      }, peerId);

      console.log(`Remaining peers: ${this.connections.size}`);
    });

    // Handle errors
    ws.addEventListener('error', (err) => {
      console.error(`WebSocket error for peer ${peerId}:`, err);
    });
  }

  handleMessage(fromPeerId, data) {
    switch (data.type) {
      case 'join':
        // Peer is announcing themselves with metadata
        this.peerMetadata.set(fromPeerId, {
          name: data.name || 'Unnamed',
          ftp: data.ftp || 200
        });

        // Broadcast new peer to everyone else
        this.broadcast({
          type: 'peer-joined',
          peerId: fromPeerId,
          name: data.name,
          ftp: data.ftp,
          isHost: this.connections.size === 1
        }, fromPeerId);
        break;

      case 'signal':
        // WebRTC signaling data (offer, answer, ICE candidates)
        // Forward to target peer
        if (data.target) {
          this.sendToPeer(data.target, {
            type: 'signal',
            from: fromPeerId,
            signal: data.signal
          });
        } else {
          console.warn(`Signal from ${fromPeerId} missing target`);
        }
        break;

      case 'request-join':
        // Participant requesting to join - notify host
        const hostPeerId = this.getHostPeerId();
        if (hostPeerId) {
          this.sendToPeer(hostPeerId, {
            type: 'request-join',
            from: fromPeerId,
            name: data.name
          });
        }
        break;

      case 'broadcast':
        // Broadcast message to all peers except sender
        this.broadcast({
          type: 'broadcast',
          from: fromPeerId,
          data: data.data
        }, fromPeerId);
        break;

      default:
        console.warn(`Unknown message type from ${fromPeerId}:`, data.type);
    }
  }

  sendToPeer(peerId, message) {
    const conn = this.connections.get(peerId);
    if (conn && conn.ws) {
      try {
        conn.ws.send(JSON.stringify(message));
      } catch (err) {
        console.error(`Error sending to peer ${peerId}:`, err);
        // Connection might be dead, clean it up
        this.connections.delete(peerId);
      }
    }
  }

  broadcast(message, excludePeerId = null) {
    const messageStr = JSON.stringify(message);
    for (const [peerId, conn] of this.connections.entries()) {
      if (peerId !== excludePeerId) {
        try {
          conn.ws.send(messageStr);
        } catch (err) {
          console.error(`Error broadcasting to peer ${peerId}:`, err);
          this.connections.delete(peerId);
        }
      }
    }
  }

  getHostPeerId() {
    // Host is the first peer that joined
    let oldestPeer = null;
    let oldestTime = Infinity;

    for (const [peerId, conn] of this.connections.entries()) {
      if (conn.joinedAt < oldestTime) {
        oldestTime = conn.joinedAt;
        oldestPeer = peerId;
      }
    }

    return oldestPeer;
  }
}
