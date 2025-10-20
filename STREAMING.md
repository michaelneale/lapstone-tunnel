# SSE Streaming Support

## Problem

The tunnel was buffering entire responses before sending them back to clients. This broke Server-Sent Events (SSE) streaming used by the goose-server `/reply` endpoint, which needs to stream events in real-time.

**Before**: 
- Client connects to tunnel → Tunnel waits for complete response → Returns all data at once
- SSE streams would only be received after the entire conversation completed

**After**:
- Client connects to tunnel → Tunnel streams data as it arrives → Real-time SSE events

## Changes Made

### 1. Client (`client.js`)

**Old behavior**: Buffered all response data until `res.on('end')`, then sent complete response

**New behavior**: Streams each chunk as it arrives

```javascript
res.on('data', chunk => {
  // Send each chunk immediately
  const response = {
    requestId,
    status: res.statusCode,
    headers: isFirstChunk ? responseHeaders : undefined,
    body: chunk.toString(),
    chunkIndex: chunkIndex++,
    isStreaming: true,
    isFirstChunk: isFirstChunk,
    isLastChunk: false
  };
  ws.send(JSON.stringify(response));
});

res.on('end', () => {
  // Send final chunk marker
  const response = {
    requestId,
    isStreaming: true,
    isLastChunk: true
  };
  ws.send(JSON.stringify(response));
});
```

### 2. Multiplexer (`src/multiplexer.js`)

**Old behavior**: Used Promises to wait for complete response, then returned Response object

**New behavior**: Uses ReadableStream to stream data as it arrives

#### Key changes:

1. **handleProxyRequest**: Creates a ReadableStream that can be written to as chunks arrive
   ```javascript
   const stream = new ReadableStream({
     start: (controller) => {
       this.pendingRequests.set(requestId, {
         streamController: controller,
         resolve: (response) => { /* handle non-streaming */ },
         reject: (error) => { /* handle errors */ }
       });
     }
   });
   
   return new Response(stream, {
     status: 200,
     headers: {
       'Content-Type': 'text/event-stream',
       'Cache-Control': 'no-cache',
       'Connection': 'keep-alive'
     }
   });
   ```

2. **handleAgentMessage**: Enqueues chunks to the stream as they arrive
   ```javascript
   if (isStreaming) {
     if (isFirstChunk) {
       pending.streamController.enqueue(new TextEncoder().encode(body));
     } else if (isLastChunk) {
       pending.streamController.close();
     } else {
       pending.streamController.enqueue(new TextEncoder().encode(body));
     }
   }
   ```

## Message Protocol

The tunnel now supports THREE types of responses:

### 1. Real-Time Streaming (`isStreaming`)

For SSE and other streaming endpoints where data arrives over time:

Each chunk sent from client to multiplexer:
```json
{
  "requestId": "req_123_1234567890",
  "status": 200,
  "headers": {...},  // Only on first chunk
  "body": "data: {...}\n\n",
  "isStreaming": true,
  "isFirstChunk": true,  // Only on first chunk
  "isLastChunk": false
}
```

Final chunk:
```json
{
  "requestId": "req_123_1234567890",
  "body": "",
  "isStreaming": true,
  "isFirstChunk": false,
  "isLastChunk": true
}
```

**Detection**: Automatically used for responses with `Content-Type: text/event-stream`

### 2. Large Response Chunking (`isChunked`)

For large buffered responses that exceed WebSocket message size limits (>900KB):

```json
{
  "requestId": "req_123_1234567890",
  "status": 200,
  "headers": {...},  // Only on first chunk
  "body": "part1...",
  "chunkIndex": 0,
  "totalChunks": 3,
  "isChunked": true
}
```

**Use case**: Endpoints like `/sessions` that return huge JSON responses

### 3. Simple Response (Legacy)

For regular small HTTP responses:
```json
{
  "requestId": "req_123_1234567890",
  "status": 200,
  "headers": {...},
  "body": "..."
}
```

## Benefits

1. **Real-time streaming**: SSE events are received as they're generated
2. **Lower latency**: First byte arrives immediately instead of waiting for complete response
3. **Better UX**: Users see progress in real-time (important for AI responses)
4. **Memory efficient**: No need to buffer large responses
5. **Backward compatible**: Non-streaming responses still work

## Testing

To test streaming:

```bash
# Deploy to Cloudflare
npm run deploy

# Test SSE endpoint through tunnel
curl -N https://your-worker.workers.dev/tunnel/your-agent-id/reply \
  -H "Content-Type: application/json" \
  -H "x-secret-key: test" \
  -d '{"messages":[...],"session_id":"test"}'
```

You should see `data: {...}` events arrive in real-time, not all at once.

## Technical Notes

- **Timeout**: Increased from 30s to 120s for streaming responses
- **Headers**: Must be sent with first chunk only (Cloudflare Workers limitation)
- **TextEncoder**: Used to convert strings to Uint8Array for ReadableStream
- **Detection**: Automatically detects streaming by checking `Content-Type: text/event-stream` header
