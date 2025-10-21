# Architecture

## System Overview

```mermaid
graph TB
    subgraph Internet
        HTTP[HTTP Client<br/>Browser/App/curl]
    end
    
    subgraph Cloudflare Workers
        Worker[Worker Entry Point<br/>index.js]
        
        subgraph "Durable Object (one per agent)"
            DO[TunnelMultiplexer<br/>- agents Map<br/>- pendingRequests Map<br/>- chunkedResponses Map]
        end
    end
    
    subgraph "Behind NAT/Firewall"
        Client[Client Agent<br/>client.js]
        LocalApp[Local Application<br/>localhost:8000]
    end
    
    HTTP -->|"GET /tunnel/agent-123/api/data"| Worker
    Worker -->|"Route to DO for agent-123"| DO
    DO <-->|"Persistent WebSocket<br/>(bidirectional)"| Client
    Client -->|"HTTP to localhost"| LocalApp
    LocalApp -->|"Response"| Client
    Client -->|"Stream back via WS"| DO
    DO -->|"HTTP Response"| HTTP
    
    style DO fill:#ff9900
    style Client fill:#00aa00
    style Worker fill:#0099ff
```

## Connection Flow

### 1. Client Connection (Persistent Tunnel)

```mermaid
sequenceDiagram
    participant Client as Client Agent<br/>(behind NAT)
    participant Worker as Worker<br/>index.js
    participant DO as Durable Object<br/>TunnelMultiplexer
    
    Note over Client: Client initiates<br/>outbound connection
    Client->>Worker: WebSocket to /connect?agent_id=agent-123
    Worker->>DO: Route to DO instance<br/>idFromName("agent-123")
    DO->>DO: Create WebSocket pair
    DO->>DO: Store in agents Map
    DO-->>Client: WebSocket 101 Upgrade
    
    Note over Client,DO: Persistent connection established
    
    loop Every 20 seconds
        Client->>DO: ping (keepalive)
    end
```

### 2. HTTP Request Flow

```mermaid
sequenceDiagram
    participant HTTP as HTTP Client
    participant Worker as Worker<br/>index.js
    participant DO as Durable Object<br/>TunnelMultiplexer
    participant Client as Client Agent
    participant Local as localhost:8000
    
    HTTP->>Worker: GET /tunnel/agent-123/api/data
    Worker->>DO: /proxy?agent_id=agent-123&path=/api/data
    
    DO->>DO: Generate requestId<br/>req_1_1234567890
    DO->>DO: Create ReadableStream<br/>Store in pendingRequests
    DO->>Client: WebSocket message<br/>{requestId, method, path, headers, body}
    
    Client->>Local: HTTP GET /api/data
    
    alt Small Response (<900KB)
        Local-->>Client: Response (complete)
        Client->>DO: {requestId, status, headers, body}
        DO->>DO: Write to stream & close
        DO-->>HTTP: HTTP Response
    else Large Response (>900KB)
        Local-->>Client: Response (complete, 2MB)
        Client->>DO: Chunk 0/3 {isChunked, chunkIndex: 0}
        Client->>DO: Chunk 1/3 {isChunked, chunkIndex: 1}
        Client->>DO: Chunk 2/3 {isChunked, chunkIndex: 2}
        DO->>DO: Reassemble all chunks
        DO->>DO: Write full body & close
        DO-->>HTTP: HTTP Response
    else Streaming Response (SSE)
        Local-->>Client: Stream chunk 1
        Client->>DO: {isStreaming, isFirstChunk: true}
        DO->>HTTP: Start streaming
        Local-->>Client: Stream chunk 2...N
        Client->>DO: {isStreaming, isFirstChunk: false}
        DO->>HTTP: Continue streaming
        Local-->>Client: Stream complete
        Client->>DO: {isStreaming, isLastChunk: true}
        DO->>HTTP: Close stream
    end
```

## Component Responsibilities

```mermaid
graph LR
    subgraph "Worker (index.js)"
        A[Stateless Router]
        A --> B[/connect endpoint]
        A --> C[/tunnel endpoint]
        A --> D[/health endpoint]
    end
    
    subgraph "Durable Object (multiplexer.js)"
        E[Stateful Multiplexer]
        E --> F[Accept WebSocket<br/>from clients]
        E --> G[Store agent<br/>connections]
        E --> H[Route HTTP requests<br/>to agents]
        E --> I[Handle streaming<br/>responses]
        E --> J[Reassemble chunked<br/>responses]
    end
    
    subgraph "Client (client.js)"
        K[NAT Traversal Agent]
        K --> L[Maintain persistent<br/>WebSocket]
        K --> M[Forward requests<br/>to localhost]
        K --> N[Detect response type<br/>Content-Type]
        K --> O[Stream/chunk<br/>responses]
    end
    
    B -.Route.-> F
    C -.Route.-> H
    H -.WebSocket.-> K
```

# Response Handling Architecture

## How It Tells Them Apart

The system distinguishes between three response types automatically:

```
┌─────────────────────────────────────────────────────────────────────┐
│ CLIENT (client.js)                                                   │
│                                                                      │
│  HTTP Response arrives from localhost                               │
│         ↓                                                            │
│  Check Content-Type header                                          │
│         ↓                                                            │
│  ┌──────────────────────────────────────────────────┐              │
│  │ Is it "text/event-stream"?                       │              │
│  └──────────────────────────────────────────────────┘              │
│         ↓                              ↓                             │
│       YES                             NO                             │
│         ↓                              ↓                             │
│  ┌──────────────┐              ┌──────────────┐                    │
│  │ Stream Mode  │              │ Buffer Mode  │                    │
│  └──────────────┘              └──────────────┘                    │
│         ↓                              ↓                             │
│  Send each chunk                Wait for complete                   │
│  immediately with:              response, then check size           │
│    isStreaming: true                   ↓                             │
│    isFirstChunk: bool           ┌──────────────┐                    │
│    isLastChunk: bool            │ Size > 900KB? │                   │
│                                 └──────────────┘                    │
│                                    ↓         ↓                       │
│                                  YES        NO                       │
│                                    ↓         ↓                       │
│                            Split into     Send as                    │
│                            chunks with:   single msg                │
│                            isChunked: true  (no flags)              │
│                            chunkIndex: N                             │
│                            totalChunks: M                            │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ MULTIPLEXER (Durable Object)                                        │
│                                                                      │
│  All requests get a ReadableStream                                  │
│         ↓                                                            │
│  Wait 100ms for first message                                       │
│         ↓                                                            │
│  ┌──────────────────────────────────────┐                          │
│  │ Did response complete within 100ms?  │                          │
│  └──────────────────────────────────────┘                          │
│         ↓                    ↓                                       │
│       YES                   NO                                       │
│         ↓                    ↓                                       │
│  Return with             Return with                                │
│  actual headers          SSE headers                                │
│  (buffered response)     (streaming)                                │
│         ↓                    ↓                                       │
│  ┌──────────────────────────────────────┐                          │
│  │ Message arrives from client          │                          │
│  └──────────────────────────────────────┘                          │
│         ↓                                                            │
│  ┌──────────────────────────────────────┐                          │
│  │ Which type?                           │                          │
│  └──────────────────────────────────────┘                          │
│         ↓                ↓              ↓                            │
│   isStreaming?     isChunked?      Neither                          │
│         ↓                ↓              ↓                            │
│  Write to stream   Collect chunks   Write full                      │
│  immediately       in array,        body and                        │
│  chunk by chunk    reassemble       close stream                    │
│                    when complete                                     │
│                    then write full                                   │
│                    body and close                                    │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ HTTP CLIENT (Swift, Browser, curl)                                  │
│                                                                      │
│  Receives HTTP Response with ReadableStream body                    │
│         ↓                                                            │
│  ┌──────────────────────────────────────┐                          │
│  │ Is Content-Type: text/event-stream?  │                          │
│  └──────────────────────────────────────┘                          │
│         ↓                    ↓                                       │
│       YES                   NO                                       │
│         ↓                    ↓                                       │
│  Stream events           Wait for complete                          │
│  as they arrive          response body                              │
│  (SSE parser)            (standard HTTP)                            │
│         ↓                    ↓                                       │
│  data: {...}             Full JSON/HTML                             │
│  data: {...}             response                                   │
│  data: {...}                                                         │
└─────────────────────────────────────────────────────────────────────┘
```

## Who Assembles What?

### Client (client.js)
- **Assembles**: Nothing
- **Disassembles**: Large responses (>900KB) into chunks for WebSocket transport
- **Detection**: Uses HTTP response headers (`Content-Type`)

### Multiplexer (Durable Object)
- **Assembles**: Large chunked responses (`isChunked`) back into complete body
- **Streams through**: Real-time streaming responses (`isStreaming`) chunk by chunk
- **Detection**: Uses message flags from client

### HTTP Client (Swift, Browser, etc.)
- **Assembles**: Nothing - just receives standard HTTP responses
- **Streaming**: Handles SSE naturally if `Content-Type: text/event-stream`
- **Buffered**: Receives complete response for normal endpoints

## Seamless Experience

From the **HTTP client's perspective**, it's completely transparent:

```javascript
// Swift code (example)
let url = URL(string: "https://worker.dev/tunnel/agent-id/reply")!
var request = URLRequest(url: url)
request.httpMethod = "POST"
// ... set body, headers ...

// For SSE endpoints:
let source = EventSource(request: request)
source.onmessage = { event in
    print("Got event:", event.data)  // Arrives in real-time! ✨
}

// For regular endpoints:
let (data, response) = try await URLSession.shared.data(for: request)
let json = try JSONDecoder().decode(MyType.self, from: data)
// Works normally, even if response was >900KB ✅
```

The client code doesn't need to know about:
- WebSocket chunking for large responses
- Message reassembly
- Whether the tunnel is being used or direct connection

**It just works!** 🎉

## Summary

**Seamless**: YES ✅
- Client assembles large buffered responses (`isChunked`)
- Client streams real-time responses (`isStreaming`) 
- HTTP clients see standard HTTP responses with correct headers
- No special client-side handling needed

**Detection**: Automatic
- Based on HTTP `Content-Type` header
- Based on response size
- Uses different message flags internally but transparent to end user
