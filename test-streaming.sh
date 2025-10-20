#!/bin/bash

# Test script for SSE streaming through tunnel
# This assumes:
# - goose-server is running on localhost:62996
# - client.js is connected to your deployed worker
# - You have a valid agent_id

WORKER_URL="${1:-https://your-worker.workers.dev}"
AGENT_ID="${2:-your-agent-id}"

echo "Testing SSE streaming through tunnel..."
echo "Worker URL: $WORKER_URL"
echo "Agent ID: $AGENT_ID"
echo ""
echo "You should see SSE events arriving in real-time:"
echo ""

# Create a simple test message
TEST_MESSAGE='{
  "messages": [
    {
      "role": "user",
      "content": [{"type": "text", "text": "Say hello"}],
      "created": '$(date +%s)'000
    }
  ],
  "session_id": "test-streaming-'$(date +%s)'"
}'

# Make the request with streaming enabled
curl -N "$WORKER_URL/tunnel/$AGENT_ID/reply" \
  -H "Content-Type: application/json" \
  -H "x-secret-key: test" \
  -d "$TEST_MESSAGE" \
  --no-buffer

echo ""
echo "Test complete!"
