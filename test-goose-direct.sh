#!/bin/bash

if [ -f ".env" ]; then
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^#.*$ ]] && continue
        [ -z "$key" ] && continue
        [[ "$key" =~ ^[A-Z_]+ ]] && export "$key"="$value"
    done < .env
fi

GOOSE_BIN="${GOOSE_BIN:-./bin/goose}"

export GOOSE_PATH_ROOT="$(pwd)/test-goose-home"
export RUST_LOG=info

echo "Starting goose CLI interactively..."
echo "GOOSE_PATH_ROOT=$GOOSE_PATH_ROOT"
echo ""

$GOOSE_BIN
