#!/bin/bash
# Ensure we are in the directory of the script
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    echo "Installing requirements..."
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

PORT=${PORT_EMBEDDER:-3003}
export FASTEMBED_CACHE_PATH="${FASTEMBED_CACHE_PATH:-$(pwd)/.cache/fastembed}"

# Start server on port $PORT
echo "Starting Embedder Service on port $PORT..."
echo "Using fastembed cache at $FASTEMBED_CACHE_PATH"
# Use exec to replace shell with gunicorn so signals work
exec gunicorn -w 1 -b 127.0.0.1:$PORT service:app
