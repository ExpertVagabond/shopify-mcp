/**
 * Order tools for Shopify Admin API.
 */

import { getClient, sanitizeId } from "../api.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyOrder {
  id: number;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_discounts: string;
  total_shipping_price_set?: { shop_money: { amount: string } };
  currency: string;
  order_number: number;
  note: string | null;
  tags: string;
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  line_items: ShopifyLineItem[];
  shipping_address?: ShopifyAddress;
  billing_address?: ShopifyAddress;
  fulfillments?: ShopifyFulfillment[];
}

interface ShopifyLineItem {
  id: number;
  title: string;
  variant_title: string;
  quantity: number;
  price: string;
  sku: string;
  product_id: number;
  variant_id: number;
  fulfillment_status: string | null;
}

interface ShopifyAddress {
  first_name: string;
  last_name: string;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  zip: string;
  country: string;
}

interface ShopifyFulfillment {
  id: number;
  status: string;
  tracking_number: string | null;
  tracking_url: string | null;
  tracking_company: string | null;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatOrder(o: ShopifyOrder, detailed = false): string {
  const customer = o.customer
    ? `${o.customer.first_name} ${o.customer.last_name} (${o.customer.email})`
    : "Guest";
  const itemCount = o.line_items?.reduce((sum, li) => sum + li.quantity, 0) ?? 0;

  const summary = [
    `**${o.name}** (ID: ${o.id})`,
    `  Customer: ${customer}`,
    `  Total: $${o.total_price} ${o.currency} | Items: ${itemCount}`,
    `  Financial: ${o.financial_status} | Fulfillment: ${o.fulfillment_status || "unfulfilled"}`,
    `  Created: ${o.created_at}`,
    o.tags ? `  Tags: ${o.tags}` : null,
  ].filter(Boolean).join("\n");

  if (!detailed) return summary;

  const lineItems = (o.line_items ?? []).map((li) =>
    `    - ${li.title}${li.variant_title ? ` (${li.variant_title})` : ""} x${li.quantity} @ $${li.price} | SKU: ${li.sku || "N/A"} | Fulfillment: ${li.fulfillment_status || "unfulfilled"}`,
  );

  const shipping = o.shipping_address
    ? `  Shipping: ${o.shipping_address.first_name} ${o.shipping_address.last_name}, ${o.shipping_address.address1}${o.shipping_address.address2 ? ` ${o.shipping_address.address2}` : ""}, ${o.shipping_address.city}, ${o.shipping_address.province} ${o.shipping_address.zip}, ${o.shipping_address.country}`
    : "  Shipping: N/A";

  const fulfillments = (o.fulfillments ?? []).map((f) =>
    `    - Fulfillment ${f.id}: ${f.status} | Tracking: ${f.tracking_number || "N/A"} (${f.tracking_company || "N/A"}) | ${f.created_at}`,
  );

  return [
    summary,
    `  Subtotal: $${o.subtotal_price} | Tax: $${o.total_tax} | Discounts: $${o.total_discounts}`,
    shipping,
    o.note ? `  Note: ${o.note}` : null,
    "",
    "  Line items:",
    ...lineItems,
    fulfillments.length ? "\n  Fulfillments:" : null,
    ...(fulfillments.length ? fulfillments : []),
  ].filter((l) => l !== null).join("\n");
}

// ── Tool implementations ─────────────────────────────────────────────────────

export async function listOrders(args: {
  status?: string;
  financial_status?: string;
  fulfillment_status?: string;
  created_at_min?: string;
  created_at_max?: string;
  limit?: number;
}): Promise<string> {
  const client = getClient();
  const params: Record<string, string | number | boolean> = {
    limit: args.limit ?? 50,
    status: args.status ?? "any",
  };
  if (args.financial_status) params.financial_status = args.financial_status;
  if (args.fulfillment_status) params.fulfillment_status = args.fulfillment_status;
  if (args.created_at_min) params.created_at_min = args.created_at_min;
  if (args.created_at_max) params.created_at_max = args.created_at_max;

  const data = await client.getData<{ orders: ShopifyOrder[] }>("/orders.json", params);
  const orders = data.orders;

  if (orders.length === 0) {
    return "No orders found matching the given filters.";
  }

  const lines = orders.map((o) => formatOrder(o, false));
  return `Found ${orders.length} orders:\n\n${lines.join("\n\n")}`;
}

export async function getOrder(args: { order_id: string }): Promise<string> {
  const client = getClient();
  const id = sanitizeId(args.order_id);
  const data = await client.getData<{ order: ShopifyOrder }>(
    `/orders/${id}.json`,
  );
  return formatOrder(data.order, true);
}

export async function recentOrders(args: { count?: number }): Promise<string> {
  const client = getClient();
  const limit = Math.min(args.count ?? 10, 250);
  const data = await client.getData<{ orders: ShopifyOrder[] }>("/orders.json", {
    limit,
    status: "any",
    order: "created_at desc",
  });
  const orders = data.orders;

  if (orders.length === 0) {
    return "No recent orders found.";
  }

  const lines = orders.map((o) => formatOrder(o, false));
  return `${orders.length} most recent orders:\n\n${lines.join("\n\n")}`;
}

export async function unfulfilledOrders(args: { limit?: number }): Promise<string> {
  const client = getClient();
  const data = await client.getData<{ orders: ShopifyOrder[] }>("/orders.json", {
    limit: args.limit ?? 50,
    status: "open",
    fulfillment_status: "unfulfilled",
  });
  const orders = data.orders;

  if (orders.length === 0) {
    return "No unfulfilled orders found.";
  }

  const lines = orders.map((o) => {
    const customer = o.customer
      ? `${o.customer.first_name} ${o.customer.last_name}`
      : "Guest";
    const itemCount = o.line_items?.reduce((sum, li) => sum + li.quantity, 0) ?? 0;
    return `- ${o.name} | ${customer} | $${o.total_price} | ${itemCount} items | ${o.created_at}`;
  });

  return `${orders.length} unfulfilled orders:\n\n${lines.join("\n")}`;
}

export async function orderCount(args: {
  status?: string;
  financial_status?: string;
  fulfillment_status?: string;
  created_at_min?: string;
  created_at_max?: string;
}): Promise<string> {
  const client = getClient();
  const params: Record<string, string | number | boolean> = {
    status: args.status ?? "any",
  };
  if (args.financial_status) params.financial_status = args.financial_status;
  if (args.fulfillment_status) params.fulfillment_status = args.fulfillment_status;
  if (args.created_at_min) params.created_at_min = args.created_at_min;
  if (args.created_at_max) params.created_at_max = args.created_at_max;

  const data = await client.getData<{ count: number }>("/orders/count.json", params);

  const filterDesc = Object.entries(args)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return `Order count${filterDesc ? ` (${filterDesc})` : ""}: ${data.count}`;
}
