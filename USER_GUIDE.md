# Cloudflare Tunnel Proxy - User Guide

**Expose your localhost to the internet through Cloudflare's global edge network.**

No VPNs. No daemons. Just a Worker and a simple Node.js script.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [How It Works](#how-it-works)
3. [Installation](#installation)
4. [Usage Examples](#usage-examples)
5. [Security Best Practices](#security-best-practices)
6. [Troubleshooting](#troubleshooting)
7. [API Reference](#api-reference)

---

## Quick Start

### 1. Deploy the Worker (One Time Setup)

```bash
# Clone or navigate to the project
cd cloudflare-tunnel-goosed

# Login to Cloudflare
wrangler login

# Deploy
wrangler deploy
```

You'll get a URL like: `https://cloudflare-tunnel-proxy.your-name.workers.dev`

### 2. Start Your Local Service

```bash
# Example: Python HTTP server
python -m http.server 8000

# Or your own app
npm run dev  # listening on localhost:3000
```

### 3. Connect the Tunnel Client

```bash
# Install dependencies (first time only)
npm install

# Connect the tunnel
node client.js \
  https://cloudflare-tunnel-proxy.your-name.workers.dev \
  my-laptop \
  your-secret-token \
  http://localhost:8000
```

### 4. Access From Anywhere

```bash
curl https://cloudflare-tunnel-proxy.your-name.workers.dev/tunnel/my-laptop/
```

**That's it!** Your localhost is now accessible globally through Cloudflare's edge.

---

## How It Works

```
┌─────────┐      HTTPS       ┌──────────────┐
│ Internet│ ───────────────> │   Cloudflare │
│  Client │                  │    Worker    │
└─────────┘                  └──────┬───────┘
                                    │
                              ┌─────▼──────┐
                              │  Durable   │
                              │   Object   │
                              └─────┬──────┘
                                    │ WebSocket
                              ┌─────▼──────┐
                              │   Tunnel   │
                              │   Client   │
                              └─────┬──────┘
                                    │ HTTP
                              ┌─────▼──────┐
                              │ localhost  │
                              │   :8000    │
                              └────────────┘
```

**Flow:**
1. Client opens WebSocket to Worker with bearer token
2. Worker creates/connects to a Durable Object for that agent
3. Internet requests hit Worker → DO → WebSocket → Client
4. Client proxies to localhost and streams response back

**Key Features:**
- ✅ Global edge deployment (200+ locations)
- ✅ Persistent WebSocket connections
- ✅ Automatic reconnection
- ✅ Bearer token authentication
- ✅ Multiple agents supported
- ✅ ~100 lines of client code

---

## Installation

### Prerequisites

- **Node.js** 16+ (for the client)
- **Wrangler CLI** (for deployment)
- **Cloudflare Account** (free tier works!)

### Setup

```bash
# Install Wrangler globally
npm install -g wrangler

# Clone/download the project
cd cloudflare-tunnel-goosed

# Install client dependencies
npm install

# Login to Cloudflare
wrangler login

# Deploy the Worker
wrangler deploy
```

**Note your Worker URL** - you'll need it to run the client.

---

## Usage Examples

### Example 1: Share Local Dev Server

```bash
# Terminal 1: Your dev server
npm run dev  # Running on localhost:3000

# Terminal 2: Tunnel client
node client.js \
  https://your-worker.workers.dev \
  dev-server \
  $(openssl rand -hex 16) \
  http://localhost:3000

# Share this URL with teammates:
# https://your-worker.workers.dev/tunnel/dev-server/
```

### Example 2: Demo API to Client

```bash
# Terminal 1: Your API
./api-server --port 8080

# Terminal 2: Connect tunnel
node client.js \
  https://your-worker.workers.dev \
  demo-api \
  secret123 \
  http://localhost:8080

# Client accesses your API:
# https://your-worker.workers.dev/tunnel/demo-api/api/users
# https://your-worker.workers.dev/tunnel/demo-api/api/products
```

### Example 3: Multiple Machines

```bash
# On your laptop
node client.js https://worker.dev laptop token1 http://localhost:8000

# On your desktop
node client.js https://worker.dev desktop token2 http://localhost:9000

# Access each independently:
curl https://worker.dev/tunnel/laptop/
curl https://worker.dev/tunnel/desktop/
```

### Example 4: Using Environment Variables

```bash
# Create .env file (gitignored)
cat > .env << EOF
WORKER_URL=https://your-worker.workers.dev
AGENT_ID=laptop
TOKEN=$(openssl rand -hex 32)
TARGET=http://localhost:8000
EOF

# Source and run
export $(cat .env | xargs)
node client.js
```

### Example 5: Background Process

```bash
# Run client in background
nohup node client.js \
  https://worker.dev \
  my-laptop \
  secret-token \
  http://localhost:8000 \
  > tunnel.log 2>&1 &

# Check it's running
tail -f tunnel.log

# Stop it later
pkill -f "node client.js"
```

---

## Security Best Practices

### 🔒 Use Strong Tokens

```bash
# Generate a secure random token
openssl rand -hex 32

# Or use a password manager
# Never commit tokens to git!
```

### 🔒 Keep Tokens Secret

```bash
# Add to .gitignore
echo ".env" >> .gitignore
echo "*.token" >> .gitignore

# Store in environment variables, not in scripts
export TUNNEL_TOKEN=$(openssl rand -hex 32)
node client.js $WORKER_URL $AGENT_ID $TUNNEL_TOKEN
```

### 🔒 Use Unique Agent IDs

```bash
# Good: Specific identifiers
node client.js $WORKER_URL laptop-work-123 $TOKEN
node client.js $WORKER_URL macbook-home-456 $TOKEN

# Bad: Generic names (easier to guess)
node client.js $WORKER_URL test $TOKEN
node client.js $WORKER_URL dev $TOKEN
```

### 🔒 Firewall Your Local Service

```bash
# Only bind to localhost (not 0.0.0.0)
python -m http.server 8000 --bind 127.0.0.1

# Or use firewall rules
# The tunnel is your only access point
```

### 🔒 Rotate Tokens Regularly

```bash
# Generate new token monthly
NEW_TOKEN=$(openssl rand -hex 32)

# Update your .env or config
# Restart client with new token
```

### ⚠️ Important Warnings

1. **Anyone with your token + agent-id can access your service**
2. **Don't use this for production without additional auth**
3. **The Worker has no rate limiting by default**
4. **Your localhost is exposed to the internet - be careful what you run**
5. **Use HTTPS endpoints only (wss:// for WebSocket)**

---

## Troubleshooting

### Client Won't Connect

**Symptom:** `WebSocket error: Unauthorized` or connection refused

**Solutions:**
```bash
# 1. Check Worker is deployed
wrangler deployments list

# 2. Verify Worker URL is correct
curl https://your-worker.workers.dev/health

# 3. Check token is being sent
# Look at client logs for "Authorization: Bearer ..."

# 4. Try with verbose logging
# (add console.log in client.js if needed)
```

### Requests Timeout

**Symptom:** `504 Gateway Timeout` or no response

**Solutions:**
```bash
# 1. Is client running?
ps aux | grep "node client.js"

# 2. Is agent-id correct?
# URL: /tunnel/{agent-id}/path
# Must match client agent-id exactly

# 3. Is local service accessible?
curl http://localhost:8000

# 4. Check client logs
tail -f tunnel.log
```

### WebSocket Keeps Disconnecting

**Symptom:** Client reconnects every few seconds

**Solutions:**
```bash
# 1. Check network stability
ping cloudflare.com

# 2. Check Cloudflare Worker logs
wrangler tail

# 3. Check for port conflicts
lsof -i :8000

# 4. Try different local port
node client.js $WORKER_URL $AGENT_ID $TOKEN http://localhost:8001
```

### Multiple Requests Fail

**Symptom:** First request works, subsequent ones fail

**Solutions:**
```bash
# Check if local service is actually staying up
curl http://localhost:8000
curl http://localhost:8000  # Try again

# Some servers need keep-alive headers
# (the client includes them automatically)

# Check Durable Object isn't hitting limits
wrangler tail --format pretty
```

### Worker Deploy Fails

**Symptom:** `Durable Objects` error during deploy

**Solutions:**
```bash
# Ensure you're using new_sqlite_classes
# Check wrangler.toml has:
[[migrations]]
tag = "v1"
new_sqlite_classes = ["TunnelMultiplexer"]

# If you used old migration, delete the Worker first
wrangler delete cloudflare-tunnel-proxy
wrangler deploy
```

---

## API Reference

### Worker Endpoints

#### `GET /`
**Description:** Service information and status

**Response:**
```json
{
  "service": "Cloudflare Tunnel Proxy",
  "version": "1.0.0",
  "endpoints": {
    "connect": "/connect?agent_id=YOUR_AGENT_ID (WebSocket with Bearer token)",
    "tunnel": "/tunnel/{agent_id}/{path} (HTTP proxy)",
    "health": "/health"
  }
}
```

#### `GET /health`
**Description:** Health check endpoint

**Response:**
```
OK
```

#### `GET /connect?agent_id={id}`
**Description:** WebSocket endpoint for agent connection

**Headers Required:**
- `Authorization: Bearer {token}`

**Query Parameters:**
- `agent_id` (required): Unique identifier for this agent

**Protocol:** WebSocket upgrade

**Message Format (Agent → Worker):**
```json
{
  "requestId": "req_123",
  "status": 200,
  "headers": {
    "content-type": "application/json"
  },
  "body": "response body"
}
```

**Message Format (Worker → Agent):**
```json
{
  "requestId": "req_123",
  "type": "proxy_request",
  "method": "GET",
  "path": "/api/endpoint",
  "headers": {
    "user-agent": "curl/7.79.1"
  },
  "body": null
}
```

#### `ANY /tunnel/{agent_id}/{path}`
**Description:** Proxy HTTP requests through the tunnel

**URL Parameters:**
- `agent_id` (required): Agent to route to
- `path` (optional): Path on the local service

**Method:** Any HTTP method (GET, POST, PUT, DELETE, etc.)

**Example:**
```bash
# Proxy GET request
curl https://worker.dev/tunnel/laptop/

# Proxy POST request
curl -X POST https://worker.dev/tunnel/laptop/api/data \
  -H "Content-Type: application/json" \
  -d '{"key":"value"}'

# Preserve query params
curl https://worker.dev/tunnel/laptop/search?q=hello
```

### Client Usage

```bash
node client.js <worker-url> <agent-id> <token> [target]
```

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `worker-url` | Yes | - | Your deployed Worker URL |
| `agent-id` | Yes | - | Unique identifier for this agent |
| `token` | Yes | - | Bearer token for authentication |
| `target` | No | `http://127.0.0.1:8000` | Local service to proxy to |

**Environment Variables:**

| Variable | Description |
|----------|-------------|
| `WORKER_URL` | Alternative to passing worker-url as arg |
| `AGENT_ID` | Alternative to passing agent-id as arg |
| `TOKEN` | Alternative to passing token as arg |
| `TARGET` | Alternative to passing target as arg |

**Exit Codes:**
- `0`: Graceful shutdown (Ctrl+C)
- `1`: Invalid arguments

---

## Advanced Configuration

### Custom Timeout

Edit `src/multiplexer.js`:
```javascript
const timeout = setTimeout(() => {
  this.pendingRequests.delete(requestId);
  reject(new Error('Request timeout'));
}, 60000); // Change from 30000 to 60000 (60 seconds)
```

### Custom Port in Client

```javascript
// In client.js, change default:
target: process.env.TARGET || process.argv[5] || 'http://127.0.0.1:3000'
```

### Local Development

```bash
# Terminal 1: Run Worker locally
wrangler dev

# Terminal 2: Run local service
python -m http.server 8000

# Terminal 3: Connect client to local Worker
node client.js http://localhost:8787 test test-token

# Terminal 4: Test
curl http://localhost:8787/tunnel/test/
```

### Production Considerations

1. **Add Rate Limiting**: Implement in Worker to prevent abuse
2. **Add Request Logging**: Track usage and debug issues
3. **Add Authentication**: Layer additional auth on top of bearer tokens
4. **Monitor Usage**: Set up alerts for Cloudflare usage
5. **Use Secrets**: Store tokens in Cloudflare Secrets instead of env vars

```bash
# Set secret in Cloudflare
wrangler secret put AGENT_TOKEN

# Access in Worker
env.AGENT_TOKEN
```

---

## Cost & Limits

### Cloudflare Free Tier

| Resource | Free Tier Limit |
|----------|----------------|
| Worker Requests | 100,000 / day |
| Worker CPU Time | 10ms / request |
| Durable Objects | 1M requests / month free |
| WebSocket Connections | Included in DO requests |

### Typical Usage (Personal)

- **Connections**: 1-5 agents = ~5 WebSocket connections
- **Requests**: 100-1000 / day = well within free tier
- **CPU Time**: <1ms per request typically

**Verdict:** Should stay free for personal use! 🎉

### Paid Tier (if needed)

- Workers Paid: $5/month + $0.50 per million requests
- Durable Objects: $0.15 per million requests after free tier

---

## FAQ

**Q: Can multiple people use the same agent-id?**  
A: No, each agent-id can only have one connected client at a time. Use unique agent-ids per machine.

**Q: What happens if the client disconnects?**  
A: Requests to that agent will return 503 until it reconnects. The client auto-reconnects every 5 seconds.

**Q: Can I use this in production?**  
A: It works, but add proper authentication, rate limiting, and monitoring first. This is designed for dev/demo use.

**Q: Does this work with HTTPS local services?**  
A: Yes, just use `https://` in the target URL. The client will make HTTPS requests.

**Q: Can I proxy WebSocket traffic?**  
A: Not currently. This only proxies HTTP request/response. WebSocket proxying would need different handling.

**Q: How do I use this with Docker?**  
A: Use `host.docker.internal` instead of `localhost`:
```bash
node client.js $WORKER_URL $AGENT_ID $TOKEN http://host.docker.internal:8000
```

**Q: Can I see Worker logs?**  
A: Yes! Use `wrangler tail` to stream real-time logs.

---

## Support & Contributing

### Get Help

- **Issues**: Open an issue on GitHub
- **Logs**: Use `wrangler tail` for Worker logs
- **Debugging**: Check client logs with `console.log` additions

### Contributing

Pull requests welcome! Please:
1. Test your changes locally with `wrangler dev`
2. Keep the client simple (<200 lines if possible)
3. Update this guide if you add features
4. Add examples for new functionality

---

## License

MIT - Do whatever you want with it!

---

**Built with ❤️ using Cloudflare Workers + Durable Objects**

Need help? Check the [Troubleshooting](#troubleshooting) section or open an issue.
