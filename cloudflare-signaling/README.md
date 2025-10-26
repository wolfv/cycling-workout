# Zwift Signaling Server

WebRTC signaling server for Zwift Hub workout sessions. Deployed on Cloudflare Workers with Durable Objects.

## What This Does

This server **only** handles the initial WebRTC connection setup (signaling). After peers are connected, all workout data (power, cadence, heart rate) goes **directly peer-to-peer** with no server involvement.

### Flow:
1. Users connect to this signaling server via WebSocket
2. Server exchanges WebRTC offers/answers between peers
3. Direct P2P connection established
4. **Signaling server is no longer used** - all data goes P2P!

## Deployment

### Prerequisites
- Node.js installed
- Cloudflare account (free tier is fine)
- Wrangler CLI

### Steps

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Login to Cloudflare**:
   ```bash
   npx wrangler login
   ```

3. **Deploy**:
   ```bash
   npm run deploy
   ```

4. **Get your Worker URL**:
   After deployment, you'll get a URL like:
   ```
   https://zwift-signaling.your-subdomain.workers.dev
   ```

5. **Update your client code**:
   In `session-p2p.js`, update the WebSocket URL:
   ```javascript
   const wsUrl = `wss://zwift-signaling.YOUR-SUBDOMAIN.workers.dev/signal/${sessionId}`;
   ```

## Local Development

Run locally for testing:
```bash
npm run dev
```

This starts a local dev server at `http://localhost:8787`

For local testing, use:
```javascript
const wsUrl = `ws://localhost:8787/signal/${sessionId}`;
```

## Endpoints

### `GET /`
Health check endpoint. Returns server status.

### `GET /health`
Same as `/` - returns server health status.

### `WebSocket /signal/:sessionId`
WebSocket endpoint for joining a session. Replace `:sessionId` with your session code.

Example:
```javascript
const ws = new WebSocket('wss://your-worker.workers.dev/signal/swift-rider-42');
```

## Message Protocol

### Client → Server

**Join session**:
```json
{
  "type": "join",
  "name": "John",
  "ftp": 250
}
```

**WebRTC signal** (offer/answer/ICE):
```json
{
  "type": "signal",
  "target": "peer-uuid",
  "signal": { ...webrtc-signal-data... }
}
```

**Request to join** (participant → host):
```json
{
  "type": "request-join",
  "name": "Jane"
}
```

### Server → Client

**Peer ID assignment**:
```json
{
  "type": "id",
  "id": "peer-uuid",
  "isHost": true
}
```

**Existing peers list**:
```json
{
  "type": "existing-peers",
  "peers": [
    { "id": "peer-uuid", "name": "John", "ftp": 250 }
  ]
}
```

**New peer joined**:
```json
{
  "type": "peer-joined",
  "peerId": "peer-uuid",
  "name": "Jane",
  "ftp": 200,
  "isHost": false
}
```

**Peer left**:
```json
{
  "type": "peer-left",
  "peerId": "peer-uuid"
}
```

**WebRTC signal** (relayed):
```json
{
  "type": "signal",
  "from": "peer-uuid",
  "signal": { ...webrtc-signal-data... }
}
```

**Join request** (to host):
```json
{
  "type": "request-join",
  "from": "peer-uuid",
  "name": "Jane"
}
```

## Cost

Cloudflare Workers free tier includes:
- **100,000 requests per day**
- **Durable Objects**: 1 million operations/month

For a workout session app, this is more than enough. A typical session uses:
- ~10 signaling messages per peer connection
- 1 Durable Object per active session

**Example**: 1000 users creating 500 sessions = ~5,000 requests = **FREE**

## Monitoring

View real-time logs:
```bash
npm run tail
```

Or use the Cloudflare dashboard:
https://dash.cloudflare.com → Workers → zwift-signaling → Logs

## Security Notes

- CORS is set to `*` for development. For production, update to your domain:
  ```javascript
  'Access-Control-Allow-Origin': 'https://your-domain.com'
  ```

- Session IDs should be unpredictable (use UUIDs or long random strings)

- Consider adding rate limiting for production use

## Troubleshooting

**Connection timeout**:
- Check WebSocket URL is correct (wss:// for HTTPS)
- Verify CORS headers
- Check browser console for errors

**Peer won't connect**:
- Ensure both peers are in the same session
- Check NAT/firewall isn't blocking WebRTC
- Verify STUN servers are accessible

**Worker not deploying**:
- Run `wrangler whoami` to verify login
- Check `wrangler.toml` syntax
- Ensure Durable Objects are enabled in your Cloudflare account

## License

MIT
