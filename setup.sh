#!/usr/bin/env bash
set -euo pipefail

# snaptrade-trade-mcp — First-time setup
# Usage: ./setup.sh

echo "=== snaptrade-trade-mcp Setup ==="
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: node is required (>=18). https://nodejs.org"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required."; exit 1; }

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js >=18 required (found $(node --version))."
  exit 1
fi

# Environment
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
  echo "  --> Edit .env and fill in your SNAPTRADE_* credentials before starting the server."
  echo ""
else
  echo ".env already exists — skipping copy."
fi

# Dependencies
echo "Installing dependencies..."
npm install

# Build
echo "Building TypeScript..."
npm run build

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your SnapTrade credentials (SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY,"
echo "     SNAPTRADE_USER_ID, SNAPTRADE_USER_SECRET)."
echo "  2. Register with Claude Code — add to your MCP config (see README.md for the JSON snippet)."
echo "  3. Start the server: node dist/index.js"
echo "  4. Using Claude Code? CLAUDE.md has full project context."
