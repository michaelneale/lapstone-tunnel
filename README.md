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

## Security

⚠️ **There is NO security at the tunnel layer.**

- Anyone who guesses your agent-id can access your service
- Use a long random ID: `laptop-$(openssl rand -hex 8)`
- Add your own auth to your service (API keys, passwords, etc.)
- This is just dumb pipes - like port forwarding

**Think ngrok/localtunnel but even simpler.**

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
wrangler login
wrangler deploy
```

Now use your own URL instead.

## Files

- `client.js` - Node.js client (~120 lines)
- `src/index.js` - Worker entry point (~110 lines)
- `src/multiplexer.js` - Durable Object (~200 lines)

Total: ~430 lines of code.

## FAQ

**Q: Is this secure?**  
A: No. Anyone who knows your agent-id can access your tunnel. Add auth to your service.

**Q: Can I use this in production?**  
A: No. This is for development/demos. Deploy your own Worker if you need more control.

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
