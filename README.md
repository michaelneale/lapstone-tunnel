# Cloudflare Tunnel Proxy

**Expose your localhost through Cloudflare's global edge network. No VPNs. No daemons. Just a Worker and a ~100 line Node.js script.**

```
Internet → Cloudflare Worker → Durable Object → WebSocket → Your Laptop → localhost
```

## ⚡ Quick Start

```bash
# 1. Deploy to Cloudflare (one time)
wrangler login
wrangler deploy

# 2. Start your local service
python -m http.server 8000

# 3. Connect the tunnel
npm install
node client.js https://your-worker.workers.dev my-laptop secret-token

# 4. Access from anywhere!
curl https://your-worker.workers.dev/tunnel/my-laptop/
```

**Done!** Your localhost is now globally accessible through Cloudflare. 🎉

## Why This?

- ✅ **Simple**: One Worker, one script (~100 lines)
- ✅ **Fast**: WebSocket multiplexing, global edge
- ✅ **Free**: Cloudflare free tier is plenty for personal use
- ✅ **No Daemon**: Just run when you need it
- ✅ **Multiple Agents**: Run clients on different machines

## Use Cases

- Share local dev server with teammates
- Demo your local API to clients
- Test webhooks locally
- Access home server from anywhere
- Quick prototypes without deployment

## How It Works

1. **Client** opens WebSocket to Worker with bearer token
2. **Worker** routes requests to Durable Object for that agent
3. **DO** forwards HTTP requests via WebSocket to client
4. **Client** proxies to localhost and streams response back
5. **Worker** returns response to original caller

All traffic flows through Cloudflare's global edge network.

## Project Structure

```
├── src/
│   ├── index.js         # Worker entry point (~100 lines)
│   └── multiplexer.js   # Durable Object (~200 lines)
├── client.js            # Node.js client (~120 lines)
├── wrangler.toml        # Cloudflare config
└── USER_GUIDE.md        # Complete documentation
```

## Documentation

📖 **[Complete User Guide](USER_GUIDE.md)** - Everything you need to know:
- Installation & Setup
- Usage Examples
- Security Best Practices
- Troubleshooting
- API Reference
- FAQ

## Example Usage

### Share Dev Server
```bash
# Terminal 1: Your dev server
npm run dev  # localhost:3000

# Terminal 2: Tunnel
node client.js https://worker.dev laptop $(openssl rand -hex 16) http://localhost:3000

# Share URL: https://worker.dev/tunnel/laptop/
```

### Multiple Machines
```bash
# On laptop
node client.js https://worker.dev laptop token1 http://localhost:8000

# On desktop
node client.js https://worker.dev desktop token2 http://localhost:9000

# Access each:
curl https://worker.dev/tunnel/laptop/
curl https://worker.dev/tunnel/desktop/
```

### Background Process
```bash
nohup node client.js https://worker.dev laptop secret http://localhost:8000 > tunnel.log 2>&1 &
tail -f tunnel.log
```

## Security

⚠️ **Important:**
- Use strong random tokens: `openssl rand -hex 32`
- Anyone with token + agent-id can access your service
- Don't expose sensitive services without additional auth
- Keep tokens secret (never commit to git)

See [Security Best Practices](USER_GUIDE.md#security-best-practices) in the User Guide.

## Costs

**Free tier is plenty for personal use:**
- Workers: 100k requests/day free
- Durable Objects: 1M requests/month free
- Typical usage: <1000 requests/day

## Local Development

```bash
# Terminal 1: Worker
wrangler dev

# Terminal 2: Local service  
python -m http.server 8000

# Terminal 3: Client
node client.js http://localhost:8787 test test-token

# Terminal 4: Test
curl http://localhost:8787/tunnel/test/
```

## Requirements

- Node.js 16+
- Cloudflare account (free tier works)
- Wrangler CLI

## Installation

```bash
# Install Wrangler
npm install -g wrangler

# Install client dependencies
npm install

# Deploy
wrangler login
wrangler deploy
```

## API

### Worker Endpoints
- `GET /` - Service info
- `GET /health` - Health check
- `GET /connect?agent_id={id}` - WebSocket (requires Bearer token)
- `ANY /tunnel/{agent_id}/{path}` - Proxy requests

### Client
```bash
node client.js <worker-url> <agent-id> <token> [target]

# Or use environment variables
WORKER_URL=... AGENT_ID=... TOKEN=... node client.js
```

## Troubleshooting

**Client won't connect?**
```bash
wrangler deployments list
curl https://your-worker.workers.dev/health
```

**Requests timeout?**
```bash
ps aux | grep "node client.js"  # Is client running?
curl http://localhost:8000       # Is local service up?
```

**More help:** See [Troubleshooting Guide](USER_GUIDE.md#troubleshooting)

## What's Different from `cloudflared tunnel`?

| Feature | This Project | cloudflared |
|---------|-------------|-------------|
| Setup | Deploy Worker, run script | Install daemon, configure |
| Lines of Code | ~400 total | Thousands |
| Process | On-demand | Always running |
| Use Case | Dev/demo | Production |
| Cost | Free tier plenty | Free/paid |

## Contributing

PRs welcome! Keep it simple:
- Client should stay under 200 lines
- Test with `wrangler dev`
- Update USER_GUIDE.md for new features

## License

MIT - Do whatever you want!

## Built With

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- WebSockets
- Node.js

---

**Need more info?** → Read the [Complete User Guide](USER_GUIDE.md)

**Questions?** → Open an issue

**Like it?** → Star the repo! ⭐
