// Zwift Hub Signaling Server - Main Entry Point
// This worker handles WebSocket connections and routes them to Durable Objects

export { SignalingRoom } from './SignalingRoom.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Upgrade',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // Health check endpoint
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'Zwift Signaling Server',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // WebSocket connection for session signaling
    // Route: /signal/:sessionId
    const match = url.pathname.match(/^\/signal\/(.+)$/);
    if (match) {
      const sessionId = match[1];

      // Check if this is a WebSocket upgrade request
      if (request.headers.get('Upgrade') === 'websocket') {
        // Get or create Durable Object for this session
        const id = env.SIGNALING_ROOM.idFromName(sessionId);
        const stub = env.SIGNALING_ROOM.get(id);

        // Forward the WebSocket upgrade request to the Durable Object
        return stub.fetch(request);
      }

      // If not WebSocket, return session info
      return new Response(JSON.stringify({
        sessionId,
        message: 'Connect via WebSocket to join this session'
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // 404 for unknown routes
    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders
    });
  }
};
