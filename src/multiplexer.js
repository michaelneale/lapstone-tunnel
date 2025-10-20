/**
 * TunnelMultiplexer - Durable Object that maintains WebSocket connections
 * to client agents and routes HTTP requests to them
 */
export class TunnelMultiplexer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Map of agentId -> WebSocket connection
    this.agents = new Map();
    // Map of requestId -> {resolve, reject, timeout} for pending requests
    this.pendingRequests = new Map();
    // Map of requestId -> {chunks, totalChunks, headers, status} for chunked responses
    this.chunkedResponses = new Map();
    this.requestIdCounter = 0;
  }

  /**
   * Handle incoming fetch requests to the Durable Object
   */
  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket upgrade for agent connections
    if (url.pathname === '/connect') {
      return this.handleAgentConnect(request);
    }

    // HTTP proxy requests
    if (url.pathname === '/proxy') {
      return this.handleProxyRequest(request);
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Handle agent WebSocket connection
   */
  async handleAgentConnect(request) {
    // Extract agent ID from URL
    const url = new URL(request.url);
    const agentId = url.searchParams.get('agent_id');
    
    if (!agentId) {
      return new Response('Missing agent_id parameter', { status: 400 });
    }

    // Upgrade to WebSocket
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket connection
    server.accept();

    // Store the agent connection
    this.agents.set(agentId, {
      socket: server,
      connectedAt: Date.now()
    });

    console.log(`Agent ${agentId} connected. Total agents: ${this.agents.size}`);

    // Handle incoming messages from agent
    server.addEventListener('message', async (event) => {
      try {
        const message = JSON.parse(event.data);
        await this.handleAgentMessage(agentId, message);
      } catch (error) {
        console.error(`Error handling agent message from ${agentId}:`, error);
      }
    });

    // Handle agent disconnect
    server.addEventListener('close', () => {
      this.agents.delete(agentId);
      console.log(`Agent ${agentId} disconnected. Total agents: ${this.agents.size}`);
    });

    server.addEventListener('error', (error) => {
      console.error(`WebSocket error for agent ${agentId}:`, error);
      this.agents.delete(agentId);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle messages from agent (responses to proxied requests)
   */
  async handleAgentMessage(agentId, message) {
    const { requestId, type, status, headers, body, error, isChunked, chunkIndex, totalChunks } = message;

    if (!requestId) {
      console.error('Received message without requestId from', agentId);
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      console.warn(`No pending request found for requestId ${requestId}`);
      return;
    }

    if (error) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      this.chunkedResponses.delete(requestId);
      pending.reject(new Error(error));
      return;
    }

    // Handle chunked responses
    if (isChunked) {
      let chunkedData = this.chunkedResponses.get(requestId);
      if (!chunkedData) {
        chunkedData = {
          chunks: new Array(totalChunks),
          totalChunks,
          status,
          headers: headers || {}
        };
        this.chunkedResponses.set(requestId, chunkedData);
      }

      chunkedData.chunks[chunkIndex] = body;

      // Check if we have all chunks
      const receivedChunks = chunkedData.chunks.filter(c => c !== undefined).length;
      if (receivedChunks === totalChunks) {
        // All chunks received, reassemble
        const fullBody = chunkedData.chunks.join('');
        
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
        this.chunkedResponses.delete(requestId);

        pending.resolve({
          status: chunkedData.status,
          headers: chunkedData.headers,
          body: fullBody
        });
      }
      // Otherwise wait for more chunks
      return;
    }

    // Handle single-message response
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    pending.resolve({
      status: status || 200,
      headers: headers || {},
      body: body || ''
    });
  }

  /**
   * Handle incoming proxy request and route to agent
   */
  async handleProxyRequest(request) {
    const url = new URL(request.url);
    const agentId = url.searchParams.get('agent_id');

    if (!agentId) {
      return new Response('Missing agent_id parameter', { status: 400 });
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      return new Response('Agent not connected', { status: 503 });
    }

    // Generate unique request ID
    const requestId = `req_${++this.requestIdCounter}_${Date.now()}`;

    // Extract request details
    const method = request.method;
    const path = url.searchParams.get('path') || '/';
    const headers = {};
    for (const [key, value] of request.headers.entries()) {
      // Skip cloudflare-specific headers
      if (!key.startsWith('cf-')) {
        headers[key] = value;
      }
    }

    let body = null;
    if (request.body && method !== 'GET' && method !== 'HEAD') {
      body = await request.text();
    }

    // Create promise for response
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
    });

    // Send request to agent
    const message = {
      requestId,
      type: 'proxy_request',
      method,
      path,
      headers,
      body
    };

    try {
      agent.socket.send(JSON.stringify(message));
    } catch (error) {
      this.pendingRequests.delete(requestId);
      return new Response('Failed to send request to agent', { status: 500 });
    }

    // Wait for response
    try {
      const response = await responsePromise;
      return new Response(response.body, {
        status: response.status,
        headers: response.headers
      });
    } catch (error) {
      return new Response(error.message, { status: 504 });
    }
  }

  /**
   * List connected agents (for debugging)
   */
  listAgents() {
    const agents = [];
    for (const [agentId, agent] of this.agents.entries()) {
      agents.push({
        agentId,
        connectedAt: agent.connectedAt
      });
    }
    return agents;
  }
}
