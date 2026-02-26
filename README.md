# shopify-mcp

MCP server for the Shopify Admin REST API. Provides 22 tools for managing products, orders, customers, inventory, fulfillments, and analytics from Claude Code or any MCP-compatible client.

## Features

- **Products** — list, search, get details with variants/images/metafields, count, collections
- **Orders** — list with filters, get details, recent orders, unfulfilled orders, count
- **Customers** — search, get details with order history, top customers by spend/orders
- **Inventory** — check levels across locations, find low stock, adjust quantities
- **Analytics** — store summary, sales by product, fulfillment status breakdown
- **Fulfillments** — list fulfillments, create with tracking info

Built with:
- TypeScript strict mode
- `@modelcontextprotocol/sdk` (stdio transport)
- Shopify Admin REST API `2024-10`
- Rate limiting with exponential backoff and `Retry-After` support
- Cursor-based pagination via Link headers
- Zero external HTTP dependencies (built-in `fetch`)

## Setup

### 1. Install dependencies and build

```bash
cd /Volumes/Virtual\ Server/projects/shopify-mcp
npm install
npm run build
```

### 2. Get a Shopify Admin API access token

1. In your Shopify admin, go to **Settings > Apps and sales channels > Develop apps**
2. Create a new app (or use an existing one)
3. Configure Admin API scopes:
   - `read_products`, `write_products`
   - `read_orders`, `write_orders`
   - `read_customers`
   - `read_inventory`, `write_inventory`
   - `read_locations`
   - `read_fulfillments`, `write_fulfillments`
4. Install the app and copy the Admin API access token

### 3. Configure environment variables

```bash
export SHOPIFY_STORE_DOMAIN="your-store.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_xxxxxxxxxxxxxxxxxxxx"
```

### 4. Add to Claude Code MCP config

Add to your `~/.mcp.json` or VS settings:

```json
{
  "mcpServers": {
    "shopify": {
      "command": "/Volumes/Virtual Server/projects/shopify-mcp/shopify-mcp-wrapper.sh",
      "env": {
        "SHOPIFY_STORE_DOMAIN": "schneiders.myshopify.com",
        "SHOPIFY_ACCESS_TOKEN": "shpat_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Tools Reference

| Tool | Description |
|------|-------------|
| `list_products` | List/filter products by title, vendor, type, collection, status |
| `get_product` | Detailed product info with variants, images, metafields |
| `search_products` | Full-text search across titles, vendors, tags, SKUs |
| `product_count` | Count products matching filters |
| `list_collections` | List smart and custom collections |
| `list_orders` | List/filter orders by status, dates, fulfillment |
| `get_order` | Detailed order with line items, shipping, fulfillments |
| `recent_orders` | Most recent N orders |
| `unfulfilled_orders` | Orders waiting for fulfillment |
| `order_count` | Count orders matching filters |
| `search_customers` | Search by name, email, phone |
| `get_customer` | Customer details with addresses and order history |
| `top_customers` | Ranked by total spend or order count |
| `check_inventory` | Inventory levels across locations for a product |
| `list_locations` | All warehouse/store locations |
| `low_stock_products` | Products below inventory threshold |
| `adjust_inventory` | Adjust inventory at a location |
| `store_summary` | Today's orders, revenue, fulfillment breakdown |
| `sales_by_product` | Revenue and units by product for a date range |
| `fulfillment_status_summary` | Order counts by fulfillment status |
| `list_fulfillments` | Fulfillments for an order with tracking |
| `create_fulfillment` | Create fulfillment with tracking info |

## API Rate Limiting

The client implements Shopify's rate limiting best practices:
- Monitors `X-Shopify-Shop-Api-Call-Limit` header
- Proactive throttling when approaching the limit
- Respects `Retry-After` on 429 responses
- Exponential backoff on 5xx errors
- Up to 3 retries for transient failures

## Architecture

```
src/
  index.ts          # MCP server setup, tool registration
  api.ts            # Shopify REST client (rate limiting, pagination, retries)
  tools/
    products.ts     # Product & collection tools
    orders.ts       # Order tools
    customers.ts    # Customer tools
    inventory.ts    # Inventory & location tools
    analytics.ts    # Store analytics tools
    fulfillments.ts # Fulfillment tools
```

## License

MIT
