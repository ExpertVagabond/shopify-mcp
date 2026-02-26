#!/usr/bin/env bash
# Wrapper script for shopify-mcp MCP server.
# Used by Claude Code MCP configuration.
#
# Required environment variables (set below or in your shell):
#   SHOPIFY_STORE_DOMAIN  — e.g. "schneiders.myshopify.com"
#   SHOPIFY_ACCESS_TOKEN  — Shopify Admin API access token

# Uncomment and set these, or export them in your shell profile:
# export SHOPIFY_STORE_DOMAIN="schneiders.myshopify.com"
# export SHOPIFY_ACCESS_TOKEN="shpat_xxxxxxxxxxxxxxxxxxxxxxxx"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "${SCRIPT_DIR}/dist/index.js"
