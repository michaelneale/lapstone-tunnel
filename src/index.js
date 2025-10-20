/**
 * Main Worker entry point
 * Routes requests to the appropriate Durable Object instance
 */

import { TunnelMultiplexer } from './multiplexer.js';

export { TunnelMultiplexer };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Agent connection endpoint
    if (url.pathname === '/connect') {
      return handleAgentConnection(request, env);
    }

    // Proxy endpoint - routes HTTP requests through the tunnel
    if (url.pathname.startsWith('/tunnel/')) {
      return handleTunnelRequest(request, env);
    }

    // Status/info endpoint
    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({
          service: 'Cloudflare Tunnel Proxy',
          version: '1.0.0',
          endpoints: {
            connect: '/connect?agent_id=YOUR_AGENT_ID (WebSocket with Bearer token)',
            tunnel: '/tunnel/{agent_id}/{path} (HTTP proxy)',
            health: '/health'
          }
        }, null, 2),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response('Not found', { status: 404 });
  }
};

/**
 * Handle agent WebSocket connection
 * Forwards to the appropriate Durable Object
 */
async function handleAgentConnection(request, env) {
  // Extract agent ID from query params
  const url = new URL(request.url);
  const agentId = url.searchParams.get('agent_id');

  if (!agentId) {
    return new Response('Missing agent_id parameter', { status: 400 });
  }

  // Get or create a Durable Object for this agent
  // We use the agent ID as the Durable Object ID to ensure the same
  // agent always connects to the same DO instance
  const id = env.TUNNEL_MULTIPLEXER.idFromName(agentId);
  const stub = env.TUNNEL_MULTIPLEXER.get(id);

  // Forward the request to the Durable Object
  return stub.fetch(request);
}

/**
 * Handle HTTP proxy request through the tunnel
 * URL format: /tunnel/{agent_id}/{path}
 */
async function handleTunnelRequest(request, env) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(p => p);

  // Parse path: /tunnel/{agent_id}/{...rest}
  if (pathParts.length < 2 || pathParts[0] !== 'tunnel') {
    return new Response('Invalid tunnel URL format. Use /tunnel/{agent_id}/{path}', { 
      status: 400 
    });
  }

  const agentId = pathParts[1];
  const targetPath = '/' + pathParts.slice(2).join('/') + url.search;

  // Get the Durable Object for this agent
  const id = env.TUNNEL_MULTIPLEXER.idFromName(agentId);
  const stub = env.TUNNEL_MULTIPLEXER.get(id);

  // Create a new request to the Durable Object's proxy endpoint
  const proxyUrl = new URL(request.url);
  proxyUrl.pathname = '/proxy';
  proxyUrl.searchParams.set('agent_id', agentId);
  proxyUrl.searchParams.set('path', targetPath);

  const proxyRequest = new Request(proxyUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });

  return stub.fetch(proxyRequest);
}
