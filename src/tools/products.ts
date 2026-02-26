/**
 * Product & collection tools for Shopify Admin API.
 */

import { getClient } from "../api.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  handle: string;
  status: string;
  tags: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  options: ShopifyOption[];
}

interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  compare_at_price: string | null;
  sku: string;
  barcode: string | null;
  position: number;
  inventory_item_id: number;
  inventory_quantity: number;
  weight: number;
  weight_unit: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
}

interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
  position: number;
  width: number;
  height: number;
}

interface ShopifyOption {
  id: number;
  name: string;
  values: string[];
}

interface ShopifyCollection {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  sort_order: string;
  published_at: string | null;
  updated_at: string;
}

interface ShopifyMetafield {
  id: number;
  namespace: string;
  key: string;
  value: string;
  type: string;
}

// ── Tool implementations ─────────────────────────────────────────────────────

export async function listProducts(args: {
  title?: string;
  vendor?: string;
  product_type?: string;
  collection_id?: string;
  status?: string;
  limit?: number;
}): Promise<string> {
  const client = getClient();
  const params: Record<string, string | number | boolean> = {
    limit: args.limit ?? 50,
    fields: "id,title,vendor,product_type,status,handle,tags,variants,updated_at",
  };
  if (args.title) params.title = args.title;
  if (args.vendor) params.vendor = args.vendor;
  if (args.product_type) params.product_type = args.product_type;
  if (args.collection_id) params.collection_id = args.collection_id;
  if (args.status) params.status = args.status;

  const data = await client.getData<{ products: ShopifyProduct[] }>("/products.json", params);
  const products = data.products;

  if (products.length === 0) {
    return "No products found matching the given filters.";
  }

  const lines = products.map((p) => {
    const variantCount = p.variants?.length ?? 0;
    const priceRange = p.variants?.length
      ? `$${Math.min(...p.variants.map((v) => parseFloat(v.price)))} - $${Math.max(...p.variants.map((v) => parseFloat(v.price)))}`
      : "N/A";
    const totalInventory = p.variants?.reduce((sum, v) => sum + (v.inventory_quantity ?? 0), 0) ?? 0;
    return [
      `**${p.title}** (ID: ${p.id})`,
      `  Status: ${p.status} | Type: ${p.product_type || "N/A"} | Vendor: ${p.vendor || "N/A"}`,
      `  Variants: ${variantCount} | Price range: ${priceRange} | Total inventory: ${totalInventory}`,
      `  Handle: ${p.handle} | Tags: ${p.tags || "none"}`,
    ].join("\n");
  });

  return `Found ${products.length} products:\n\n${lines.join("\n\n")}`;
}

export async function getProduct(args: { product_id: string }): Promise<string> {
  const client = getClient();
  const data = await client.getData<{ product: ShopifyProduct }>(
    `/products/${args.product_id}.json`,
  );
  const p = data.product;

  // Also fetch metafields
  let metafields: ShopifyMetafield[] = [];
  try {
    const mfData = await client.getData<{ metafields: ShopifyMetafield[] }>(
      `/products/${args.product_id}/metafields.json`,
    );
    metafields = mfData.metafields;
  } catch {
    // metafield access may be restricted
  }

  const variantLines = (p.variants ?? []).map((v) =>
    `  - ${v.title} (ID: ${v.id}): $${v.price}${v.compare_at_price ? ` (was $${v.compare_at_price})` : ""} | SKU: ${v.sku || "N/A"} | Inventory: ${v.inventory_quantity} | Barcode: ${v.barcode || "N/A"} | Weight: ${v.weight}${v.weight_unit}`,
  );

  const imageLines = (p.images ?? []).map((img) =>
    `  - ${img.alt || "No alt text"}: ${img.src} (${img.width}x${img.height})`,
  );

  const optionLines = (p.options ?? []).map((opt) =>
    `  - ${opt.name}: ${opt.values.join(", ")}`,
  );

  const metafieldLines = metafields.map((mf) =>
    `  - ${mf.namespace}.${mf.key} (${mf.type}): ${mf.value}`,
  );

  const sections = [
    `# ${p.title} (ID: ${p.id})`,
    `Status: ${p.status} | Type: ${p.product_type || "N/A"} | Vendor: ${p.vendor || "N/A"}`,
    `Handle: ${p.handle}`,
    `Tags: ${p.tags || "none"}`,
    `Created: ${p.created_at} | Updated: ${p.updated_at} | Published: ${p.published_at || "unpublished"}`,
    "",
    p.body_html ? `## Description\n${p.body_html}` : "",
    "",
    `## Options (${p.options?.length ?? 0})`,
    optionLines.length ? optionLines.join("\n") : "  None",
    "",
    `## Variants (${p.variants?.length ?? 0})`,
    variantLines.length ? variantLines.join("\n") : "  None",
    "",
    `## Images (${p.images?.length ?? 0})`,
    imageLines.length ? imageLines.join("\n") : "  None",
    "",
    `## Metafields (${metafields.length})`,
    metafieldLines.length ? metafieldLines.join("\n") : "  None",
  ];

  return sections.filter(Boolean).join("\n");
}

export async function searchProducts(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  // The REST API doesn't have a dedicated search endpoint for products,
  // so we fetch products and filter locally, or use the title param.
  // For a real search we'd use GraphQL, but REST title filter is serviceable.
  const client = getClient();
  const params: Record<string, string | number | boolean> = {
    limit: args.limit ?? 50,
    fields: "id,title,vendor,product_type,status,handle,tags,variants",
  };

  // Shopify REST supports partial title matching
  const data = await client.getData<{ products: ShopifyProduct[] }>("/products.json", params);
  const query = args.query.toLowerCase();
  const matched = data.products.filter(
    (p) =>
      p.title.toLowerCase().includes(query) ||
      (p.vendor && p.vendor.toLowerCase().includes(query)) ||
      (p.product_type && p.product_type.toLowerCase().includes(query)) ||
      (p.tags && p.tags.toLowerCase().includes(query)) ||
      (p.handle && p.handle.toLowerCase().includes(query)) ||
      (p.variants ?? []).some((v) => v.sku?.toLowerCase().includes(query)),
  );

  if (matched.length === 0) {
    return `No products found matching "${args.query}".`;
  }

  const lines = matched.map((p) => {
    const totalInventory = p.variants?.reduce((sum, v) => sum + (v.inventory_quantity ?? 0), 0) ?? 0;
    const priceRange = p.variants?.length
      ? `$${Math.min(...p.variants.map((v) => parseFloat(v.price)))} - $${Math.max(...p.variants.map((v) => parseFloat(v.price)))}`
      : "N/A";
    return `- **${p.title}** (ID: ${p.id}) | ${p.status} | ${priceRange} | Inventory: ${totalInventory} | SKU: ${p.variants?.[0]?.sku || "N/A"}`;
  });

  return `Found ${matched.length} products matching "${args.query}":\n\n${lines.join("\n")}`;
}

export async function productCount(args: {
  vendor?: string;
  product_type?: string;
  collection_id?: string;
  status?: string;
}): Promise<string> {
  const client = getClient();
  const params: Record<string, string | number | boolean> = {};
  if (args.vendor) params.vendor = args.vendor;
  if (args.product_type) params.product_type = args.product_type;
  if (args.collection_id) params.collection_id = args.collection_id;
  if (args.status) params.status = args.status;

  const data = await client.getData<{ count: number }>("/products/count.json", params);

  const filterDesc = Object.entries(args)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return `Product count${filterDesc ? ` (${filterDesc})` : ""}: ${data.count}`;
}

export async function listCollections(args: {
  limit?: number;
}): Promise<string> {
  const client = getClient();
  const limit = args.limit ?? 50;

  // Fetch both custom and smart collections
  const [customData, smartData] = await Promise.all([
    client.getData<{ custom_collections: ShopifyCollection[] }>("/custom_collections.json", { limit }),
    client.getData<{ smart_collections: ShopifyCollection[] }>("/smart_collections.json", { limit }),
  ]);

  const custom = customData.custom_collections ?? [];
  const smart = smartData.smart_collections ?? [];
  const all = [
    ...custom.map((c) => ({ ...c, type: "custom" as const })),
    ...smart.map((c) => ({ ...c, type: "smart" as const })),
  ];

  if (all.length === 0) {
    return "No collections found.";
  }

  const lines = all.map((c) =>
    `- **${c.title}** (ID: ${c.id}) | Type: ${c.type} | Handle: ${c.handle} | Published: ${c.published_at ? "yes" : "no"}`,
  );

  return `Found ${all.length} collections (${custom.length} custom, ${smart.length} smart):\n\n${lines.join("\n")}`;
}
