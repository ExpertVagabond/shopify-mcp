/**
 * Customer tools for Shopify Admin API.
 */

import { getClient } from "../api.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  orders_count: number;
  total_spent: string;
  created_at: string;
  updated_at: string;
  tags: string;
  note: string | null;
  verified_email: boolean;
  state: string;
  addresses?: ShopifyCustomerAddress[];
  default_address?: ShopifyCustomerAddress;
  last_order_id?: number;
  last_order_name?: string;
}

interface ShopifyCustomerAddress {
  id: number;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  zip: string;
  country: string;
  default: boolean;
}

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  total_price: string;
  financial_status: string;
  fulfillment_status: string | null;
}

// ── Tool implementations ─────────────────────────────────────────────────────

export async function searchCustomers(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  const client = getClient();

  // Shopify REST search endpoint: /customers/search.json?query=
  const data = await client.getData<{ customers: ShopifyCustomer[] }>(
    "/customers/search.json",
    {
      query: args.query,
      limit: args.limit ?? 25,
      fields: "id,email,first_name,last_name,phone,orders_count,total_spent,state,tags,created_at",
    },
  );
  const customers = data.customers;

  if (customers.length === 0) {
    return `No customers found matching "${args.query}".`;
  }

  const lines = customers.map((c) =>
    `- **${c.first_name} ${c.last_name}** (ID: ${c.id})\n  Email: ${c.email} | Phone: ${c.phone || "N/A"}\n  Orders: ${c.orders_count} | Total spent: $${c.total_spent} | State: ${c.state}\n  Tags: ${c.tags || "none"}`,
  );

  return `Found ${customers.length} customers matching "${args.query}":\n\n${lines.join("\n\n")}`;
}

export async function getCustomer(args: {
  customer_id: string;
  include_orders?: boolean;
}): Promise<string> {
  const client = getClient();
  const data = await client.getData<{ customer: ShopifyCustomer }>(
    `/customers/${args.customer_id}.json`,
  );
  const c = data.customer;

  const sections = [
    `# ${c.first_name} ${c.last_name} (ID: ${c.id})`,
    `Email: ${c.email}${c.verified_email ? " (verified)" : " (unverified)"} | Phone: ${c.phone || "N/A"}`,
    `State: ${c.state} | Orders: ${c.orders_count} | Total spent: $${c.total_spent}`,
    `Created: ${c.created_at} | Updated: ${c.updated_at}`,
    c.tags ? `Tags: ${c.tags}` : null,
    c.note ? `Note: ${c.note}` : null,
  ].filter(Boolean);

  // Default address
  if (c.default_address) {
    const addr = c.default_address;
    sections.push(
      "",
      "## Default Address",
      `${addr.address1}${addr.address2 ? `, ${addr.address2}` : ""}`,
      `${addr.city}, ${addr.province} ${addr.zip}, ${addr.country}`,
    );
  }

  // All addresses
  if (c.addresses && c.addresses.length > 1) {
    sections.push("", `## All Addresses (${c.addresses.length})`);
    for (const addr of c.addresses) {
      sections.push(
        `- ${addr.address1}${addr.address2 ? `, ${addr.address2}` : ""}, ${addr.city}, ${addr.province} ${addr.zip}, ${addr.country}${addr.default ? " (default)" : ""}`,
      );
    }
  }

  // Optionally fetch recent orders
  if (args.include_orders !== false) {
    try {
      const orderData = await client.getData<{ orders: ShopifyOrder[] }>(
        `/customers/${args.customer_id}/orders.json`,
        {
          limit: 10,
          status: "any",
          fields: "id,name,created_at,total_price,financial_status,fulfillment_status",
        },
      );
      const orders = orderData.orders;
      if (orders.length > 0) {
        sections.push("", `## Recent Orders (${orders.length})`);
        for (const o of orders) {
          sections.push(
            `- ${o.name}: $${o.total_price} | ${o.financial_status} | ${o.fulfillment_status || "unfulfilled"} | ${o.created_at}`,
          );
        }
      }
    } catch {
      // Customer may not have orders or scope may be limited
    }
  }

  return sections.join("\n");
}

export async function topCustomers(args: {
  sort_by?: string;
  limit?: number;
}): Promise<string> {
  const client = getClient();
  const sortBy = args.sort_by ?? "total_spent";

  // Shopify REST doesn't support sorting customers by spend directly,
  // so we fetch a batch and sort locally.
  const allCustomers = await client.fetchAll<{ customers: ShopifyCustomer[] }>(
    "/customers.json",
    "customers",
    {
      fields: "id,email,first_name,last_name,orders_count,total_spent,created_at,tags",
    },
    3, // max 3 pages = up to 750 customers
  ) as ShopifyCustomer[];

  if (allCustomers.length === 0) {
    return "No customers found.";
  }

  // Sort
  const sorted = [...allCustomers].sort((a, b) => {
    if (sortBy === "orders_count") return b.orders_count - a.orders_count;
    return parseFloat(b.total_spent) - parseFloat(a.total_spent);
  });

  const top = sorted.slice(0, args.limit ?? 20);

  const lines = top.map((c, i) =>
    `${i + 1}. **${c.first_name} ${c.last_name}** (${c.email}) | Orders: ${c.orders_count} | Total spent: $${c.total_spent}`,
  );

  return `Top ${top.length} customers by ${sortBy === "orders_count" ? "order count" : "total spend"} (from ${allCustomers.length} total):\n\n${lines.join("\n")}`;
}
