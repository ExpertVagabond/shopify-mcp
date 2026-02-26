/**
 * Inventory & location tools for Shopify Admin API.
 */

import { getClient } from "../api.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyLocation {
  id: number;
  name: string;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  zip: string;
  country: string;
  phone: string | null;
  active: boolean;
  legacy: boolean;
}

interface ShopifyInventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number | null;
  updated_at: string;
}

interface ShopifyInventoryItem {
  id: number;
  sku: string;
  tracked: boolean;
  cost: string | null;
  country_code_of_origin: string | null;
}

interface ShopifyProduct {
  id: number;
  title: string;
  variants: ShopifyVariant[];
}

interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  sku: string;
  inventory_item_id: number;
  inventory_quantity: number;
  price: string;
}

// ── Tool implementations ─────────────────────────────────────────────────────

export async function listLocations(): Promise<string> {
  const client = getClient();
  const data = await client.getData<{ locations: ShopifyLocation[] }>("/locations.json");
  const locations = data.locations;

  if (locations.length === 0) {
    return "No locations found.";
  }

  const lines = locations.map((loc) => {
    const addr = [loc.address1, loc.address2, loc.city, loc.province, loc.zip, loc.country]
      .filter(Boolean)
      .join(", ");
    return `- **${loc.name}** (ID: ${loc.id}) | Active: ${loc.active ? "yes" : "no"} | ${addr}${loc.phone ? ` | Phone: ${loc.phone}` : ""}`;
  });

  return `Found ${locations.length} locations:\n\n${lines.join("\n")}`;
}

export async function checkInventory(args: {
  product_id?: string;
  variant_id?: string;
  inventory_item_id?: string;
  location_id?: string;
}): Promise<string> {
  const client = getClient();

  // If product_id given, resolve all variant inventory_item_ids
  let inventoryItemIds: number[] = [];
  let variantMap: Map<number, { title: string; sku: string; variantTitle: string }> = new Map();

  if (args.product_id) {
    const prodData = await client.getData<{ product: ShopifyProduct }>(
      `/products/${args.product_id}.json`,
      { fields: "id,title,variants" },
    );
    const product = prodData.product;
    for (const v of product.variants) {
      inventoryItemIds.push(v.inventory_item_id);
      variantMap.set(v.inventory_item_id, {
        title: product.title,
        sku: v.sku,
        variantTitle: v.title,
      });
    }
  } else if (args.variant_id) {
    // Get variant details first to find inventory_item_id
    // Variants don't have their own top-level endpoint in REST, so we
    // look up via product. The caller should ideally pass inventory_item_id.
    // As a fallback, we'll try the inventory_items endpoint.
    // Actually, we can query inventory_levels by inventory_item_ids directly if we have it.
    if (args.inventory_item_id) {
      inventoryItemIds = [parseInt(args.inventory_item_id, 10)];
    } else {
      return "Please provide either a product_id or an inventory_item_id. Variant lookups require the parent product_id.";
    }
  } else if (args.inventory_item_id) {
    inventoryItemIds = [parseInt(args.inventory_item_id, 10)];
  } else {
    return "Please provide at least one of: product_id, variant_id + inventory_item_id, or inventory_item_id.";
  }

  if (inventoryItemIds.length === 0) {
    return "No inventory items found for the given parameters.";
  }

  // Fetch inventory levels
  const params: Record<string, string | number | boolean> = {
    inventory_item_ids: inventoryItemIds.join(","),
  };
  if (args.location_id) params.location_ids = args.location_id;

  const levelData = await client.getData<{ inventory_levels: ShopifyInventoryLevel[] }>(
    "/inventory_levels.json",
    params,
  );
  const levels = levelData.inventory_levels;

  if (levels.length === 0) {
    return "No inventory levels found for the given items.";
  }

  // Fetch location names for readability
  const locData = await client.getData<{ locations: ShopifyLocation[] }>("/locations.json");
  const locMap = new Map(locData.locations.map((l) => [l.id, l.name]));

  const lines = levels.map((lev) => {
    const locName = locMap.get(lev.location_id) ?? `Location ${lev.location_id}`;
    const info = variantMap.get(lev.inventory_item_id);
    const prefix = info
      ? `${info.title} - ${info.variantTitle} (SKU: ${info.sku})`
      : `Item ${lev.inventory_item_id}`;
    return `- ${prefix} @ ${locName}: **${lev.available ?? "not tracked"}** available`;
  });

  return `Inventory levels (${levels.length} entries):\n\n${lines.join("\n")}`;
}

export async function lowStockProducts(args: {
  threshold?: number;
  location_id?: string;
  limit?: number;
}): Promise<string> {
  const client = getClient();
  const threshold = args.threshold ?? 10;
  const limit = args.limit ?? 50;

  // Fetch products with variants
  const products = await client.fetchAll<{ products: ShopifyProduct[] }>(
    "/products.json",
    "products",
    {
      status: "active",
      fields: "id,title,variants",
    },
    3,
  ) as ShopifyProduct[];

  // Collect all variants with low inventory
  const lowStock: Array<{
    productTitle: string;
    productId: number;
    variantTitle: string;
    sku: string;
    quantity: number;
    inventoryItemId: number;
  }> = [];

  for (const product of products) {
    for (const variant of product.variants ?? []) {
      if (variant.inventory_quantity <= threshold) {
        lowStock.push({
          productTitle: product.title,
          productId: product.id,
          variantTitle: variant.title,
          sku: variant.sku,
          quantity: variant.inventory_quantity,
          inventoryItemId: variant.inventory_item_id,
        });
      }
    }
  }

  // Sort by quantity ascending (lowest first)
  lowStock.sort((a, b) => a.quantity - b.quantity);
  const results = lowStock.slice(0, limit);

  if (results.length === 0) {
    return `No products found with inventory at or below ${threshold}.`;
  }

  const lines = results.map((item) =>
    `- **${item.productTitle}** - ${item.variantTitle} | SKU: ${item.sku || "N/A"} | Quantity: **${item.quantity}** | Product ID: ${item.productId}`,
  );

  return `Found ${results.length} variants with inventory <= ${threshold} (from ${products.length} active products):\n\n${lines.join("\n")}`;
}

export async function adjustInventory(args: {
  inventory_item_id: string;
  location_id: string;
  adjustment: number;
  reason?: string;
}): Promise<string> {
  const client = getClient();

  // Use the inventory_levels/adjust endpoint
  const body = {
    location_id: parseInt(args.location_id, 10),
    inventory_item_id: parseInt(args.inventory_item_id, 10),
    available_adjustment: args.adjustment,
  };

  const result = await client.post<{ inventory_level: ShopifyInventoryLevel }>(
    "/inventory_levels/adjust.json",
    body,
  );

  const level = result.data.inventory_level;
  return `Inventory adjusted successfully.\n  Item: ${level.inventory_item_id} @ Location: ${level.location_id}\n  New available quantity: ${level.available}\n  Adjustment: ${args.adjustment > 0 ? "+" : ""}${args.adjustment}${args.reason ? `\n  Reason: ${args.reason}` : ""}`;
}
