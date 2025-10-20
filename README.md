# Cloudflare Tunnel Proxy

**Expose localhost through Cloudflare's edge. Super simple. No auth.**

## What is this?

A public tunnel service running at:
```
https://cloudflare-tunnel-proxy.michael-neale.workers.dev
```

Anyone can use it. No signup. No tokens. Just pick a random ID and connect.

## Usage

**1. Get the client:**
```bash
git clone <this-repo>
cd cloudflare-tunnel-goosed
npm install
```

**2. Run it:**
```bash
# Start something on localhost
python -m http.server 8000

# Connect to the tunnel (pick a random ID!)
node client.js \
  https://cloudflare-tunnel-proxy.michael-neale.workers.dev \
  my-laptop-a1b2c3d4e5f6 \
  http://localhost:8000
```

**3. Access it:**
```
https://cloudflare-tunnel-proxy.michael-neale.workers.dev/tunnel/my-laptop-a1b2c3d4e5f6/
```

Done.

## How it works

```
Internet → Cloudflare Worker → Durable Object → WebSocket → Your Client → localhost
```

1. Client opens WebSocket to Worker with agent-id
2. Worker creates a Durable Object for that agent-id
3. HTTP requests to `/tunnel/{agent-id}/path` go through the WebSocket
4. Client proxies to localhost and returns response

## Client API

```bash
node client.js <worker-url> <agent-id> [target]
```

- `worker-url`: The deployed Worker URL
- `agent-id`: Your unique ID (make it random!)
- `target`: Local service (default: `http://127.0.0.1:8000`)

**Examples:**
```bash
# Basic
node client.js https://worker.dev my-id http://localhost:8000

# Random ID
node client.js https://worker.dev laptop-$(openssl rand -hex 8)

# Different port
node client.js https://worker.dev my-id http://localhost:3000
```

## Deploy your own

Don't want to use the public service? Deploy your own:

```bash
# First time setup
wrangler login

# Deploy the worker
npx wrangler deploy
```

You'll get output like:
```
Deployed cloudflare-tunnel-proxy triggers
  https://your-worker-name.your-account.workers.dev
```

Now use your own URL instead of the public service.

## Features

- ✅ **Simple HTTP proxying** - Just works like port forwarding
- ✅ **SSE streaming** - Real-time streaming endpoints (like AI chat) work natively
- ✅ **Large response handling** - Automatically chunks responses >900KB
- ✅ **Auto-reconnect** - Client reconnects immediately if disconnected
- ✅ **Durable Objects** - Each agent gets persistent connection

## Files

- `client.js` - Node.js client (~160 lines)
- `src/index.js` - Worker entry point (~110 lines)
- `src/multiplexer.js` - Durable Object (~280 lines)

Total: ~550 lines of code.

## FAQ

**Q: How much does it cost?**  
A: Free tier covers typical personal use (100k requests/day).

**Q: What if my agent-id collides with someone else's?**  
A: First one wins. That's why you use a random ID.

**Q: Can multiple clients use the same agent-id?**  
A: No. Last one to connect wins.

## License

MIT

---

**That's it. Keep it simple.**
