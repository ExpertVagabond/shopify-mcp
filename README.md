# shopify-mcp

**MCP server for the Shopify Admin API — 36 tools for products, orders, customers, inventory, fulfillments, collections, analytics, marketing, content, and webhooks.**

[![npm version](https://img.shields.io/npm/v/shopify-mcp.svg)](https://www.npmjs.com/package/shopify-mcp)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
[![MCP](https://img.shields.io/badge/MCP-Compatible-green)](https://modelcontextprotocol.io)
[![Shopify](https://img.shields.io/badge/Shopify-Admin_API-7AB55C?logo=shopify&logoColor=white)](https://shopify.dev)

---

## Tools

### Products (5)

| Tool | Description |
|------|-------------|
| `list_products` | List/filter products by title, vendor, type, collection, status |
| `get_product` | Detailed product info with variants, images, metafields |
| `search_products` | Full-text search across titles, vendors, tags, SKUs |
| `product_count` | Count products matching filters |
| `list_collections` | List smart and custom collections |

### Orders (5)

| Tool | Description |
|------|-------------|
| `list_orders` | List/filter orders by status, dates, fulfillment |
| `get_order` | Detailed order with line items, shipping, fulfillments |
| `recent_orders` | Most recent N orders |
| `unfulfilled_orders` | Orders waiting for fulfillment |
| `order_count` | Count orders matching filters |

### Customers (3)

| Tool | Description |
|------|-------------|
| `search_customers` | Search by name, email, phone |
| `get_customer` | Customer details with addresses and order history |
| `top_customers` | Ranked by total spend or order count |

### Inventory (4)

| Tool | Description |
|------|-------------|
| `check_inventory` | Inventory levels across locations for a product |
| `list_locations` | All warehouse/store locations |
| `low_stock_products` | Products below inventory threshold |
| `adjust_inventory` | Adjust inventory at a location |

### Collections (3)

| Tool | Description |
|------|-------------|
| `get_collection` | Collection details with product count and rules |
| `collection_products` | Products within a specific collection |
| `create_smart_collection` | Create automated collections with rules |

### Fulfillments (3)

| Tool | Description |
|------|-------------|
| `list_fulfillments` | Fulfillments for an order with tracking |
| `create_fulfillment` | Create fulfillment with tracking info |
| `fulfillment_status_summary` | Order counts by fulfillment status |

### Analytics (2)

| Tool | Description |
|------|-------------|
| `store_summary` | Today's orders, revenue, fulfillment breakdown |
| `sales_by_product` | Revenue and units by product for a date range |

### Marketing (4)

| Tool | Description |
|------|-------------|
| `list_price_rules` | List all price rules |
| `get_price_rule` | Price rule details with conditions |
| `create_discount_code` | Create discount code for a price rule |
| `list_discount_codes` | List codes for a price rule |

### Content (4)

| Tool | Description |
|------|-------------|
| `list_blogs` | List blog entries |
| `list_pages` | List store pages |
| `get_metafields` | Get metafields for any resource |
| `set_metafield` | Create or update a metafield |

### Webhooks (3)

| Tool | Description |
|------|-------------|
| `list_webhooks` | List registered webhooks |
| `create_webhook` | Register a new webhook |
| `delete_webhook` | Remove a webhook |

## Setup

### Install

```bash
git clone https://github.com/ExpertVagabond/shopify-mcp.git
cd shopify-mcp
npm install && npm run build
```

### Get a Shopify Access Token

1. In Shopify admin: **Settings > Apps and sales channels > Develop apps**
2. Create app, configure Admin API scopes:
   - `read_products`, `write_products`, `read_orders`, `write_orders`
   - `read_customers`, `read_inventory`, `write_inventory`, `read_locations`
   - `read_fulfillments`, `write_fulfillments`
3. Install and copy the Admin API access token

### Claude Desktop / Claude Code Config

```json
{
  "mcpServers": {
    "shopify": {
      "command": "node",
      "args": ["/path/to/shopify-mcp/dist/index.js"],
      "env": {
        "SHOPIFY_STORE_DOMAIN": "your-store.myshopify.com",
        "SHOPIFY_ACCESS_TOKEN": "shpat_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Rate Limiting

Built-in Shopify rate limiting:
- Monitors `X-Shopify-Shop-Api-Call-Limit` header
- Proactive throttling when approaching the limit
- Respects `Retry-After` on 429 responses
- Exponential backoff on 5xx errors
- Up to 3 retries for transient failures

## Architecture

```
src/
  index.ts              MCP server setup, 36 tool registrations
  api.ts                Shopify REST client (rate limiting, pagination, retries)
  tools/
    products.ts         Product listing, search, count
    orders.ts           Order listing, details, counts
    customers.ts        Customer search, details, ranking
    inventory.ts        Stock levels, locations, adjustments
    collections.ts      Collection management
    fulfillments.ts     Fulfillment creation, tracking
    analytics.ts        Store summary, sales reports
    marketing.ts        Price rules, discount codes
    content.ts          Blogs, pages, metafields
    webhooks.ts         Webhook management
```

Built with TypeScript strict mode, `@modelcontextprotocol/sdk` (stdio transport), Shopify Admin REST API `2024-10`, cursor-based pagination, zero external HTTP dependencies.

## License

[MIT](LICENSE)

## Author

Built by [Purple Squirrel Media](https://purplesquirrelmedia.io)
