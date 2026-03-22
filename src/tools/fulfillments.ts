/**
 * Fulfillment tools for Shopify Admin API.
 *
 * Note: Shopify's fulfillment API changed significantly in 2023.
 * The 2024-10 API uses the FulfillmentOrder-based workflow.
 * We support both listing existing fulfillments and creating new ones.
 */

import { getClient, sanitizeId } from "../api.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyFulfillment {
  id: number;
  order_id: number;
  status: string;
  created_at: string;
  updated_at: string;
  tracking_company: string | null;
  tracking_number: string | null;
  tracking_numbers: string[];
  tracking_url: string | null;
  tracking_urls: string[];
  shipment_status: string | null;
  location_id: number;
  line_items: Array<{
    id: number;
    title: string;
    variant_title: string;
    quantity: number;
    sku: string;
  }>;
  name: string;
}

interface ShopifyFulfillmentOrder {
  id: number;
  order_id: number;
  status: string;
  assigned_location_id: number;
  line_items: Array<{
    id: number;
    shop_id: number;
    fulfillment_order_id: number;
    quantity: number;
    line_item_id: number;
    inventory_item_id: number;
    fulfillable_quantity: number;
    variant_id: number;
  }>;
}

// ── Tool implementations ─────────────────────────────────────────────────────

export async function listFulfillments(args: {
  order_id: string;
}): Promise<string> {
  const client = getClient();
  const orderId = sanitizeId(args.order_id);
  const data = await client.getData<{ fulfillments: ShopifyFulfillment[] }>(
    `/orders/${orderId}/fulfillments.json`,
  );
  const fulfillments = data.fulfillments;

  if (fulfillments.length === 0) {
    return `No fulfillments found for order ${args.order_id}.`;
  }

  const lines = fulfillments.map((f) => {
    const items = (f.line_items ?? [])
      .map((li) => `${li.title}${li.variant_title ? ` (${li.variant_title})` : ""} x${li.quantity}`)
      .join(", ");

    return [
      `**Fulfillment ${f.name || f.id}** (ID: ${f.id})`,
      `  Status: ${f.status} | Shipment: ${f.shipment_status || "N/A"}`,
      `  Tracking: ${f.tracking_number || "N/A"} (${f.tracking_company || "N/A"})`,
      f.tracking_url ? `  Tracking URL: ${f.tracking_url}` : null,
      `  Location ID: ${f.location_id}`,
      `  Items: ${items || "N/A"}`,
      `  Created: ${f.created_at}`,
    ].filter(Boolean).join("\n");
  });

  return `Fulfillments for order ${args.order_id} (${fulfillments.length}):\n\n${lines.join("\n\n")}`;
}

export async function createFulfillment(args: {
  order_id: string;
  tracking_number?: string;
  tracking_company?: string;
  tracking_url?: string;
  location_id?: string;
  notify_customer?: boolean;
  line_item_ids?: string[];
}): Promise<string> {
  const client = getClient();

  // Step 1: Get fulfillment orders for this order
  const orderId = sanitizeId(args.order_id);
  const foData = await client.getData<{ fulfillment_orders: ShopifyFulfillmentOrder[] }>(
    `/orders/${orderId}/fulfillment_orders.json`,
  );
  const fulfillmentOrders = foData.fulfillment_orders;

  // Filter to open fulfillment orders
  const openFOs = fulfillmentOrders.filter(
    (fo) => fo.status === "open" || fo.status === "in_progress",
  );

  if (openFOs.length === 0) {
    return `No open fulfillment orders found for order ${args.order_id}. The order may already be fully fulfilled.`;
  }

  // Step 2: Build fulfillment request using the new FulfillmentOrder-based API
  // POST /fulfillments.json (2024-10 version)
  const fulfillmentOrderLineItems = openFOs.map((fo) => ({
    fulfillment_order_id: fo.id,
    fulfillment_order_line_items: fo.line_items
      .filter((li) => li.fulfillable_quantity > 0)
      .map((li) => ({
        id: li.id,
        quantity: li.fulfillable_quantity,
      })),
  }));

  const trackingInfo: Record<string, unknown> = {};
  if (args.tracking_number) trackingInfo.number = args.tracking_number;
  if (args.tracking_company) trackingInfo.company = args.tracking_company;
  if (args.tracking_url) trackingInfo.url = args.tracking_url;

  const body: Record<string, unknown> = {
    fulfillment: {
      line_items_by_fulfillment_order: fulfillmentOrderLineItems,
      notify_customer: args.notify_customer ?? true,
      ...(Object.keys(trackingInfo).length > 0
        ? { tracking_info: trackingInfo }
        : {}),
    },
  };

  const result = await client.post<{ fulfillment: ShopifyFulfillment }>(
    "/fulfillments.json",
    body,
  );

  const f = result.data.fulfillment;
  const items = (f.line_items ?? [])
    .map((li) => `${li.title} x${li.quantity}`)
    .join(", ");

  return [
    `Fulfillment created successfully!`,
    "",
    `**Fulfillment ${f.name || f.id}** (ID: ${f.id})`,
    `Order: ${args.order_id}`,
    `Status: ${f.status}`,
    f.tracking_number ? `Tracking: ${f.tracking_number} (${f.tracking_company || "N/A"})` : "Tracking: None provided",
    f.tracking_url ? `Tracking URL: ${f.tracking_url}` : null,
    `Items: ${items || "N/A"}`,
    `Customer notified: ${args.notify_customer ?? true ? "yes" : "no"}`,
  ].filter(Boolean).join("\n");
}
