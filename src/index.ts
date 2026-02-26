#!/usr/bin/env node

/**
 * Shopify MCP Server
 *
 * Exposes Shopify Admin REST API operations as MCP tools for use with
 * Claude Code and other MCP-compatible clients.
 *
 * Required env vars:
 *   SHOPIFY_STORE_DOMAIN  — e.g. "schneiders.myshopify.com"
 *   SHOPIFY_ACCESS_TOKEN  — Shopify Admin API access token
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  listProducts,
  getProduct,
  searchProducts,
  productCount,
  listCollections,
} from "./tools/products.js";

import {
  listOrders,
  getOrder,
  recentOrders,
  unfulfilledOrders,
  orderCount,
} from "./tools/orders.js";

import {
  searchCustomers,
  getCustomer,
  topCustomers,
} from "./tools/customers.js";

import {
  listLocations,
  checkInventory,
  lowStockProducts,
  adjustInventory,
} from "./tools/inventory.js";

import {
  storeSummary,
  salesByProduct,
  fulfillmentStatusSummary,
} from "./tools/analytics.js";

import {
  listFulfillments,
  createFulfillment,
} from "./tools/fulfillments.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function wrapTool<T>(fn: (args: T) => Promise<string>): (args: T) => Promise<{ content: Array<{ type: "text"; text: string }> }> {
  return async (args: T) => {
    try {
      const text = await fn(args);
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
      };
    }
  };
}

// ── Server setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "shopify-mcp",
  version: "1.0.0",
});

// ── Product Tools ────────────────────────────────────────────────────────────

server.tool(
  "list_products",
  "List/filter products by title, vendor, product type, collection, or status",
  {
    title: z.string().optional().describe("Filter by product title"),
    vendor: z.string().optional().describe("Filter by vendor name"),
    product_type: z.string().optional().describe("Filter by product type"),
    collection_id: z.string().optional().describe("Filter by collection ID"),
    status: z.string().optional().describe("Filter by status: active, archived, draft"),
    limit: z.number().optional().describe("Max results (default 50, max 250)"),
  },
  wrapTool(listProducts),
);

server.tool(
  "get_product",
  "Get detailed product info including variants, images, options, and metafields",
  {
    product_id: z.string().describe("Shopify product ID"),
  },
  wrapTool(getProduct),
);

server.tool(
  "search_products",
  "Full-text search across product titles, vendors, types, tags, handles, and SKUs",
  {
    query: z.string().describe("Search query string"),
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  wrapTool(searchProducts),
);

server.tool(
  "product_count",
  "Count products matching filters",
  {
    vendor: z.string().optional().describe("Filter by vendor"),
    product_type: z.string().optional().describe("Filter by product type"),
    collection_id: z.string().optional().describe("Filter by collection ID"),
    status: z.string().optional().describe("Filter by status: active, archived, draft"),
  },
  wrapTool(productCount),
);

server.tool(
  "list_collections",
  "List all smart and custom collections",
  {
    limit: z.number().optional().describe("Max results per type (default 50)"),
  },
  wrapTool(listCollections),
);

// ── Order Tools ──────────────────────────────────────────────────────────────

server.tool(
  "list_orders",
  "List/filter orders by status, financial status, fulfillment status, and date range",
  {
    status: z.string().optional().describe("Order status: open, closed, cancelled, any (default: any)"),
    financial_status: z.string().optional().describe("Financial status: authorized, pending, paid, partially_paid, refunded, voided"),
    fulfillment_status: z.string().optional().describe("Fulfillment status: shipped, partial, unshipped, unfulfilled"),
    created_at_min: z.string().optional().describe("Minimum creation date (ISO 8601)"),
    created_at_max: z.string().optional().describe("Maximum creation date (ISO 8601)"),
    limit: z.number().optional().describe("Max results (default 50, max 250)"),
  },
  wrapTool(listOrders),
);

server.tool(
  "get_order",
  "Get detailed order info including line items, shipping, billing, and fulfillments",
  {
    order_id: z.string().describe("Shopify order ID"),
  },
  wrapTool(getOrder),
);

server.tool(
  "recent_orders",
  "Get the most recent N orders",
  {
    count: z.number().optional().describe("Number of recent orders (default 10, max 250)"),
  },
  wrapTool(recentOrders),
);

server.tool(
  "unfulfilled_orders",
  "Get open orders that are waiting for fulfillment",
  {
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  wrapTool(unfulfilledOrders),
);

server.tool(
  "order_count",
  "Count orders matching filters",
  {
    status: z.string().optional().describe("Order status: open, closed, cancelled, any"),
    financial_status: z.string().optional().describe("Financial status filter"),
    fulfillment_status: z.string().optional().describe("Fulfillment status filter"),
    created_at_min: z.string().optional().describe("Minimum creation date (ISO 8601)"),
    created_at_max: z.string().optional().describe("Maximum creation date (ISO 8601)"),
  },
  wrapTool(orderCount),
);

// ── Customer Tools ───────────────────────────────────────────────────────────

server.tool(
  "search_customers",
  "Search customers by name, email, phone, or any field",
  {
    query: z.string().describe("Search query (name, email, phone, etc.)"),
    limit: z.number().optional().describe("Max results (default 25)"),
  },
  wrapTool(searchCustomers),
);

server.tool(
  "get_customer",
  "Get detailed customer info including addresses and recent order history",
  {
    customer_id: z.string().describe("Shopify customer ID"),
    include_orders: z.boolean().optional().describe("Include recent orders (default true)"),
  },
  wrapTool(getCustomer),
);

server.tool(
  "top_customers",
  "Get top customers ranked by total spend or order count",
  {
    sort_by: z.string().optional().describe("Sort by: total_spent (default) or orders_count"),
    limit: z.number().optional().describe("Number of top customers (default 20)"),
  },
  wrapTool(topCustomers),
);

// ── Inventory Tools ──────────────────────────────────────────────────────────

server.tool(
  "check_inventory",
  "Check inventory levels for a product or variant across all warehouse locations",
  {
    product_id: z.string().optional().describe("Shopify product ID (checks all variants)"),
    variant_id: z.string().optional().describe("Shopify variant ID"),
    inventory_item_id: z.string().optional().describe("Shopify inventory item ID"),
    location_id: z.string().optional().describe("Filter to specific location ID"),
  },
  wrapTool(checkInventory),
);

server.tool(
  "list_locations",
  "List all warehouse and store locations with addresses",
  {},
  wrapTool(listLocations),
);

server.tool(
  "low_stock_products",
  "Find products and variants with inventory at or below a threshold",
  {
    threshold: z.number().optional().describe("Inventory threshold (default 10)"),
    location_id: z.string().optional().describe("Filter to specific location"),
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  wrapTool(lowStockProducts),
);

server.tool(
  "adjust_inventory",
  "Adjust inventory quantity for a variant at a specific location (positive to add, negative to remove)",
  {
    inventory_item_id: z.string().describe("Inventory item ID"),
    location_id: z.string().describe("Location ID"),
    adjustment: z.number().describe("Quantity adjustment (+/-)"),
    reason: z.string().optional().describe("Reason for adjustment"),
  },
  wrapTool(adjustInventory),
);

// ── Analytics Tools ──────────────────────────────────────────────────────────

server.tool(
  "store_summary",
  "Get store overview: active products, today's orders, today's revenue, fulfillment breakdown",
  {},
  wrapTool(storeSummary),
);

server.tool(
  "sales_by_product",
  "Sales breakdown by product for a date range — revenue, units sold, order count",
  {
    created_at_min: z.string().describe("Start date (ISO 8601, e.g. 2024-01-01)"),
    created_at_max: z.string().optional().describe("End date (ISO 8601)"),
    limit: z.number().optional().describe("Top N products (default 20)"),
  },
  wrapTool(salesByProduct),
);

server.tool(
  "fulfillment_status_summary",
  "Count of open orders by fulfillment status (unfulfilled, partial, shipped)",
  {
    created_at_min: z.string().optional().describe("Start date filter (ISO 8601)"),
    created_at_max: z.string().optional().describe("End date filter (ISO 8601)"),
  },
  wrapTool(fulfillmentStatusSummary),
);

// ── Fulfillment Tools ────────────────────────────────────────────────────────

server.tool(
  "list_fulfillments",
  "List all fulfillments for an order with tracking details and line items",
  {
    order_id: z.string().describe("Shopify order ID"),
  },
  wrapTool(listFulfillments),
);

server.tool(
  "create_fulfillment",
  "Create a fulfillment for an order with optional tracking info. Uses FulfillmentOrder API.",
  {
    order_id: z.string().describe("Shopify order ID"),
    tracking_number: z.string().optional().describe("Tracking number"),
    tracking_company: z.string().optional().describe("Shipping carrier (e.g. UPS, FedEx, USPS)"),
    tracking_url: z.string().optional().describe("Tracking URL"),
    location_id: z.string().optional().describe("Fulfillment location ID"),
    notify_customer: z.boolean().optional().describe("Send shipment notification email (default true)"),
    line_item_ids: z.array(z.string()).optional().describe("Specific line item IDs to fulfill (default: all)"),
  },
  wrapTool(createFulfillment),
);

// ── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Shopify MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
