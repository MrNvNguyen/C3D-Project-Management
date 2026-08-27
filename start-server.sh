#!/bin/bash
# Robust wrangler startup script - handles port conflicts and crashes gracefully

# Kill any existing wrangler/workerd processes
cleanup() {
  echo "[start-server] Cleaning up..."
  fuser -k 3000/tcp 2>/dev/null || true
  pkill -9 -f workerd 2>/dev/null || true
  pkill -9 -f "wrangler pages dev" 2>/dev/null || true
  sleep 2
}

# Initial cleanup
cleanup

# Wait for port to be truly free
MAX_WAIT=15
for i in $(seq 1 $MAX_WAIT); do
  if ! fuser 3000/tcp 2>/dev/null; then
    echo "[start-server] Port 3000 is free, starting wrangler..."
    break
  fi
  echo "[start-server] Waiting for port 3000... ($i/$MAX_WAIT)"
  sleep 1
done

# Start wrangler in background
node /home/user/webapp/node_modules/.bin/wrangler pages dev dist \
  --d1=bim-management-production \
  --local \
  --ip 0.0.0.0 \
  --port 3000 \
  --inspector-port=0 \
  --log-level=warn &

WRANGLER_PID=$!
echo "[start-server] Wrangler PID: $WRANGLER_PID"

# Wait for wrangler to be ready (health check loop)
echo "[start-server] Waiting for server to be ready..."
READY=0
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 -o /dev/null 2>/dev/null; then
    echo "[start-server] ✅ Server ready after ${i}s on port 3000"
    READY=1
    break
  fi
  # Check if wrangler process died
  if ! kill -0 $WRANGLER_PID 2>/dev/null; then
    echo "[start-server] ❌ Wrangler process died unexpectedly"
    exit 1
  fi
  sleep 1
done

if [ $READY -eq 0 ]; then
  echo "[start-server] ⚠️ Server did not respond after 40s, but continuing..."
fi

# Wait for wrangler to stay running (foreground)
wait $WRANGLER_PID
echo "[start-server] Wrangler exited, PM2 will restart..."
