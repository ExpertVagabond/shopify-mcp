#!/usr/bin/env bash
# Wrapper script for shopify-mcp MCP server.
# Used by Claude Code MCP configuration.
#
# Credential sources (in priority order):
# 1. Already-set environment variables
# 2. Credential files in the vault

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_DIR="/Volumes/Virtual Server/configs/credentials/shopify"

# Load store domain from vault if not already set
if [ -z "$SHOPIFY_STORE_DOMAIN" ] && [ -f "$VAULT_DIR/store-domain" ]; then
  export SHOPIFY_STORE_DOMAIN="$(cat "$VAULT_DIR/store-domain")"
fi

# Load access token from vault if not already set
if [ -z "$SHOPIFY_ACCESS_TOKEN" ] && [ -f "$VAULT_DIR/access-token" ]; then
  export SHOPIFY_ACCESS_TOKEN="$(cat "$VAULT_DIR/access-token")"
fi

# Validate
if [ -z "$SHOPIFY_STORE_DOMAIN" ]; then
  echo "Error: SHOPIFY_STORE_DOMAIN not set. Set it in env or create $VAULT_DIR/store-domain" >&2
  exit 1
fi

if [ -z "$SHOPIFY_ACCESS_TOKEN" ]; then
  echo "Error: SHOPIFY_ACCESS_TOKEN not set. Set it in env or create $VAULT_DIR/access-token" >&2
  exit 1
fi

exec node "${SCRIPT_DIR}/dist/index.js"
