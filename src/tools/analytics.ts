/**
 * Analytics / reporting tools for Shopify Admin API.
 *
 * These are computed from the REST API — Shopify Plus stores could use
 * the GraphQL Analytics API for richer data, but REST works universally.
 */

import { getClient } from "../api.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_discounts: string;
  financial_status: string;
  fulfillment_status: string | null;
  currency: string;
  line_items: Array<{
    product_id: number;
    title: string;
    variant_title: string;
    quantity: number;
    price: string;
    sku: string;
  }>;
}

interface ShopifyProduct {
  id: number;
  title: string;
  status: string;
  variants: Array<{
    id: number;
    inventory_quantity: number;
  }>;
}

// ── Tool implementations ─────────────────────────────────────────────────────

export async function storeSummary(): Promise<string> {
  const client = getClient();

  // Get today's date range in ISO format
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  // Parallel fetch: product count, today's orders, all-time order count
  const [productCountData, todayOrderData, totalOrderCountData] = await Promise.all([
    client.getData<{ count: number }>("/products/count.json", { status: "active" }),
    client.getData<{ orders: ShopifyOrder[] }>("/orders.json", {
      status: "any",
      created_at_min: todayStart,
      limit: 250,
    }),
    client.getData<{ count: number }>("/orders/count.json", { status: "any" }),
  ]);

  const todayOrders = todayOrderData.orders;
  const todayRevenue = todayOrders.reduce((sum, o) => sum + parseFloat(o.total_price), 0);
  const todayAvgOrder = todayOrders.length > 0 ? todayRevenue / todayOrders.length : 0;

  // Fulfillment breakdown for today
  const todayFulfilled = todayOrders.filter((o) => o.fulfillment_status === "fulfilled").length;
  const todayUnfulfilled = todayOrders.filter((o) => !o.fulfillment_status || o.fulfillment_status === "unfulfilled").length;
  const todayPartial = todayOrders.filter((o) => o.fulfillment_status === "partial").length;

  // Financial status breakdown
  const todayPaid = todayOrders.filter((o) => o.financial_status === "paid").length;
  const todayPending = todayOrders.filter((o) => o.financial_status === "pending").length;
  const todayRefunded = todayOrders.filter((o) => o.financial_status === "refunded").length;

  const currency = todayOrders[0]?.currency ?? "USD";

  return [
    "# Store Summary",
    "",
    "## Overview",
    `Active products: ${productCountData.count}`,
    `Total orders (all time): ${totalOrderCountData.count}`,
    "",
    "## Today",
    `Orders today: ${todayOrders.length}`,
    `Revenue today: $${todayRevenue.toFixed(2)} ${currency}`,
    `Average order value: $${todayAvgOrder.toFixed(2)} ${currency}`,
    "",
    "## Today's Fulfillment Status",
    `Fulfilled: ${todayFulfilled} | Unfulfilled: ${todayUnfulfilled} | Partial: ${todayPartial}`,
    "",
    "## Today's Financial Status",
    `Paid: ${todayPaid} | Pending: ${todayPending} | Refunded: ${todayRefunded}`,
  ].join("\n");
}

export async function salesByProduct(args: {
  created_at_min: string;
  created_at_max?: string;
  limit?: number;
}): Promise<string> {
  const client = getClient();
  const limit = args.limit ?? 20;

  // Fetch orders in the date range (up to 3 pages)
  const orders = await client.fetchAll<{ orders: ShopifyOrder[] }>(
    "/orders.json",
    "orders",
    {
      status: "any",
      financial_status: "paid",
      created_at_min: args.created_at_min,
      ...(args.created_at_max ? { created_at_max: args.created_at_max } : {}),
    },
    3,
  ) as ShopifyOrder[];

  if (orders.length === 0) {
    return `No paid orders found in the specified date range.`;
  }

  // Aggregate by product
  const productSales = new Map<
    number,
    { title: string; quantity: number; revenue: number; orderCount: Set<number> }
  >();

  for (const order of orders) {
    for (const item of order.line_items ?? []) {
      const existing = productSales.get(item.product_id);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue += parseFloat(item.price) * item.quantity;
        existing.orderCount.add(order.id);
      } else {
        productSales.set(item.product_id, {
          title: item.title,
          quantity: item.quantity,
          revenue: parseFloat(item.price) * item.quantity,
          orderCount: new Set([order.id]),
        });
      }
    }
  }

  // Sort by revenue descending
  const sorted = [...productSales.entries()]
    .sort(([, a], [, b]) => b.revenue - a.revenue)
    .slice(0, limit);

  const totalRevenue = sorted.reduce((sum, [, v]) => sum + v.revenue, 0);
  const totalUnits = sorted.reduce((sum, [, v]) => sum + v.quantity, 0);

  const lines = sorted.map(([productId, v], i) =>
    `${i + 1}. **${v.title}** (ID: ${productId})\n   Revenue: $${v.revenue.toFixed(2)} | Units sold: ${v.quantity} | Orders: ${v.orderCount.size}`,
  );

  const dateRange = args.created_at_max
    ? `${args.created_at_min} to ${args.created_at_max}`
    : `since ${args.created_at_min}`;

  return [
    `# Sales by Product (${dateRange})`,
    `Total orders analyzed: ${orders.length} | Total revenue (top ${sorted.length}): $${totalRevenue.toFixed(2)} | Total units: ${totalUnits}`,
    "",
    ...lines,
  ].join("\n");
}

export async function fulfillmentStatusSummary(args: {
  created_at_min?: string;
  created_at_max?: string;
}): Promise<string> {
  const client = getClient();

  // Fetch counts for each fulfillment status
  const params: Record<string, string | number | boolean> = { status: "open" };
  if (args.created_at_min) params.created_at_min = args.created_at_min;
  if (args.created_at_max) params.created_at_max = args.created_at_max;

  const [unfulfilledCount, partialCount, fulfilledCount, totalOpenCount] = await Promise.all([
    client.getData<{ count: number }>("/orders/count.json", { ...params, fulfillment_status: "unfulfilled" }),
    client.getData<{ count: number }>("/orders/count.json", { ...params, fulfillment_status: "partial" }),
    client.getData<{ count: number }>("/orders/count.json", { ...params, fulfillment_status: "shipped" }),
    client.getData<{ count: number }>("/orders/count.json", params),
  ]);

  const dateRange = args.created_at_min
    ? args.created_at_max
      ? ` (${args.created_at_min} to ${args.created_at_max})`
      : ` (since ${args.created_at_min})`
    : "";

  return [
    `# Fulfillment Status Summary${dateRange}`,
    "",
    `Total open orders: ${totalOpenCount.count}`,
    "",
    `| Status       | Count |`,
    `|-------------|-------|`,
    `| Unfulfilled | ${unfulfilledCount.count} |`,
    `| Partial     | ${partialCount.count} |`,
    `| Shipped     | ${fulfilledCount.count} |`,
    "",
    unfulfilledCount.count > 0
      ? `**Action needed:** ${unfulfilledCount.count} orders waiting for fulfillment.`
      : "All open orders are fulfilled or shipped.",
  ].join("\n");
}
