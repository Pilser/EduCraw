#!/bin/bash

if [ -f ".env" ]; then
    IFS='='
    while read -r key value; do
        [[ "$key" =~ ^#.*$ ]] && continue
        [ -z "$key" ] && continue
        [[ "$key" =~ ^[A-Z_]+ ]] && export "$key=$value"
    done < .env
fi

GOOSE_BIN="./bin/goose"
mkdir -p ./goose-home

export GOOSE_PATH_ROOT="$(pwd)/goose-home"
export RUST_LOG=info

echo "Choose mode:"
echo "1) CLI (interactive)"
echo "2) ACP (JSON-RPC)"
read -p "Enter 1 or 2: " choice

case $choice in
    1)
        echo "Starting goose CLI..."
        $GOOSE_BIN
        ;;
    2)
        echo "Starting goose ACP with XAI_API_KEY set..."
        echo "Testing JSON-RPC initialize..."
        $GOOSE_BIN acp << 'EOF'
{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"1.0"},"id":1}
EOF
        echo ""
        echo "Entering interactive ACP mode. Type JSON-RPC requests:"
        $GOOSE_BIN acp
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac
