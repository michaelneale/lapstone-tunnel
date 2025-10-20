#!/usr/bin/env node

/**
 * Cloudflare Tunnel Client
 * Super simple localhost proxy that connects to Cloudflare Worker via WebSocket
 */

const WebSocket = require('ws');
const http = require('http');

// Configuration from command line or environment
const config = {
  workerUrl: process.env.WORKER_URL || process.argv[2],
  agentId: process.env.AGENT_ID || process.argv[3],
  token: process.env.TOKEN || process.argv[4],
  target: process.env.TARGET || process.argv[5] || 'http://127.0.0.1:8000'
};

if (!config.workerUrl || !config.agentId || !config.token) {
  console.log('Usage: node client.js <worker-url> <agent-id> <token> [target]');
  console.log('   OR: WORKER_URL=... AGENT_ID=... TOKEN=... node client.js');
  console.log('\nExample:');
  console.log('  node client.js https://my-worker.workers.dev my-laptop secret-token http://127.0.0.1:8000');
  process.exit(1);
}

let ws;
let reconnectTimeout;

function connect() {
  const wsUrl = config.workerUrl
    .replace('https://', 'wss://')
    .replace('http://', 'ws://');
  
  const url = `${wsUrl}/connect?agent_id=${encodeURIComponent(config.agentId)}`;
  
  console.log(`Connecting to ${url}...`);
  
  ws = new WebSocket(url, {
    headers: {
      'Authorization': `Bearer ${config.token}`
    }
  });

  ws.on('open', () => {
    console.log(`✓ Connected as agent: ${config.agentId}`);
    console.log(`✓ Proxying to: ${config.target}`);
  });

  ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());
    await handleRequest(message);
  });

  ws.on('close', () => {
    console.log('✗ Connection closed, reconnecting in 5s...');
    reconnectTimeout = setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('✗ WebSocket error:', err.message);
  });
}

async function handleRequest(message) {
  const { requestId, method, path, headers, body } = message;
  
  console.log(`→ ${method} ${path} [${requestId}]`);

  const targetUrl = new URL(path, config.target);
  
  const options = {
    method,
    headers: headers || {},
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: targetUrl.pathname + targetUrl.search
  };

  const req = http.request(options, (res) => {
    const chunks = [];
    
    res.on('data', chunk => chunks.push(chunk));
    
    res.on('end', () => {
      const responseBody = Buffer.concat(chunks).toString();
      const responseHeaders = res.headers;
      
      const response = {
        requestId,
        status: res.statusCode,
        headers: responseHeaders,
        body: responseBody
      };
      
      ws.send(JSON.stringify(response));
      console.log(`← ${res.statusCode} ${path} [${requestId}]`);
    });
  });

  req.on('error', (err) => {
    console.error(`✗ Request error [${requestId}]:`, err.message);
    const errorResponse = {
      requestId,
      status: 500,
      error: err.message
    };
    ws.send(JSON.stringify(errorResponse));
  });

  if (body && method !== 'GET' && method !== 'HEAD') {
    req.write(body);
  }
  
  req.end();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  clearTimeout(reconnectTimeout);
  if (ws) ws.close();
  process.exit(0);
});

// Start
connect();
