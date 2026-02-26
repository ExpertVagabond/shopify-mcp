/**
 * Enhanced collection tools for Shopify Admin API.
 */

import { getClient } from "../api.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyCustomCollection {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  sort_order: string;
  published_at: string | null;
  updated_at: string;
  image: { src: string; alt: string | null } | null;
}

interface ShopifySmartCollection {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  sort_order: string;
  published_at: string | null;
  updated_at: string;
  rules: Array<{
    column: string;
    relation: string;
    condition: string;
  }>;
  disjunctive: boolean;
  image: { src: string; alt: string | null } | null;
}

interface ShopifyCollect {
  id: number;
  collection_id: number;
  product_id: number;
  position: number;
  created_at: string;
}

interface ShopifyProduct {
  id: number;
  title: string;
  vendor: string;
  product_type: string;
  status: string;
  handle: string;
  variants: Array<{
    id: number;
    price: string;
    inventory_quantity: number;
    sku: string;
  }>;
}

// ── Tool implementations ─────────────────────────────────────────────────────

export async function getCollection(args: {
  collection_id: string;
}): Promise<string> {
  const client = getClient();
  const id = args.collection_id;

  // Try custom collection first, then smart collection
  let collection: ShopifyCustomCollection | ShopifySmartCollection | null = null;
  let collectionType = "unknown";

  try {
    const data = await client.getData<{ custom_collection: ShopifyCustomCollection }>(
      `/custom_collections/${id}.json`,
    );
    collection = data.custom_collection;
    collectionType = "custom";
  } catch {
    // Not a custom collection, try smart
    try {
      const data = await client.getData<{ smart_collection: ShopifySmartCollection }>(
        `/smart_collections/${id}.json`,
      );
      collection = data.smart_collection;
      collectionType = "smart";
    } catch {
      return `Collection ${id} not found as either a custom or smart collection.`;
    }
  }

  if (!collection) {
    return `Collection ${id} not found.`;
  }

  // Get product count for this collection
  let productCount = 0;
  try {
    const countData = await client.getData<{ count: number }>(
      `/products/count.json`,
      { collection_id: id },
    );
    productCount = countData.count;
  } catch {
    // Count not available
  }

  const sections = [
    `# ${collection.title} (ID: ${collection.id})`,
    `Type: ${collectionType} | Handle: ${collection.handle}`,
    `Published: ${collection.published_at ? "yes" : "no"} | Sort: ${collection.sort_order}`,
    `Updated: ${collection.updated_at}`,
    `Products in collection: ${productCount}`,
  ];

  if (collection.body_html) {
    sections.push("", `## Description`, collection.body_html);
  }

  if (collection.image) {
    sections.push("", `Image: ${collection.image.src} (${collection.image.alt || "no alt"})`);
  }

  // Show rules for smart collections
  if (collectionType === "smart" && "rules" in collection) {
    const smart = collection as ShopifySmartCollection;
    if (smart.rules && smart.rules.length > 0) {
      sections.push(
        "",
        `## Smart Collection Rules (${smart.disjunctive ? "match ANY" : "match ALL"})`,
      );
      for (const rule of smart.rules) {
        sections.push(`  - ${rule.column} ${rule.relation} "${rule.condition}"`);
      }
    }
  }

  return sections.join("\n");
}

export async function collectionProducts(args: {
  collection_id: string;
  limit?: number;
}): Promise<string> {
  const client = getClient();
  const limit = args.limit ?? 50;

  const data = await client.getData<{ products: ShopifyProduct[] }>(
    "/products.json",
    {
      collection_id: args.collection_id,
      limit,
      fields: "id,title,vendor,product_type,status,handle,variants",
    },
  );
  const products = data.products;

  if (products.length === 0) {
    return `No products found in collection ${args.collection_id}.`;
  }

  const lines = products.map((p) => {
    const totalInventory = p.variants?.reduce((sum, v) => sum + (v.inventory_quantity ?? 0), 0) ?? 0;
    const priceRange = p.variants?.length
      ? `$${Math.min(...p.variants.map((v) => parseFloat(v.price)))} - $${Math.max(...p.variants.map((v) => parseFloat(v.price)))}`
      : "N/A";
    return `- **${p.title}** (ID: ${p.id}) | ${p.status} | ${priceRange} | Inventory: ${totalInventory} | Vendor: ${p.vendor || "N/A"}`;
  });

  return `Products in collection ${args.collection_id} (${products.length}):\n\n${lines.join("\n")}`;
}

export async function createSmartCollection(args: {
  title: string;
  rules: Array<{
    column: string;
    relation: string;
    condition: string;
  }>;
  disjunctive?: boolean;
  published?: boolean;
  sort_order?: string;
  body_html?: string;
}): Promise<string> {
  const client = getClient();

  const body = {
    smart_collection: {
      title: args.title,
      rules: args.rules,
      disjunctive: args.disjunctive ?? false,
      published: args.published ?? true,
      ...(args.sort_order ? { sort_order: args.sort_order } : {}),
      ...(args.body_html ? { body_html: args.body_html } : {}),
    },
  };

  const result = await client.post<{ smart_collection: ShopifySmartCollection }>(
    "/smart_collections.json",
    body,
  );

  const c = result.data.smart_collection;

  const ruleLines = c.rules.map(
    (r) => `  - ${r.column} ${r.relation} "${r.condition}"`,
  );

  return [
    `Smart collection created successfully!`,
    "",
    `**${c.title}** (ID: ${c.id})`,
    `Handle: ${c.handle}`,
    `Published: ${c.published_at ? "yes" : "no"}`,
    `Match mode: ${c.disjunctive ? "ANY rule" : "ALL rules"}`,
    `Sort: ${c.sort_order}`,
    "",
    `Rules (${c.rules.length}):`,
    ...ruleLines,
  ].join("\n");
}
