/**
 * Marketing tools — discounts, price rules, promotion management
 * for Shopify Admin API.
 */

import { getClient, sanitizeId } from "../api.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyPriceRule {
  id: number;
  title: string;
  target_type: string;
  target_selection: string;
  allocation_method: string;
  value_type: string;
  value: string;
  once_per_customer: boolean;
  usage_limit: number | null;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
  entitled_product_ids: number[];
  entitled_variant_ids: number[];
  entitled_collection_ids: number[];
  entitled_country_ids: number[];
  prerequisite_product_ids: number[];
  prerequisite_variant_ids: number[];
  prerequisite_collection_ids: number[];
  prerequisite_subtotal_range: { greater_than_or_equal_to: string } | null;
  prerequisite_quantity_range: { greater_than_or_equal_to: number } | null;
  prerequisite_to_entitlement_quantity_ratio: {
    prerequisite_quantity: number;
    entitled_quantity: number;
  } | null;
}

interface ShopifyDiscountCode {
  id: number;
  price_rule_id: number;
  code: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

// ── Tool implementations ─────────────────────────────────────────────────────

export async function listPriceRules(args: {
  limit?: number;
}): Promise<string> {
  const client = getClient();

  const data = await client.getData<{ price_rules: ShopifyPriceRule[] }>(
    "/price_rules.json",
    { limit: args.limit ?? 50 },
  );
  const rules = data.price_rules;

  if (rules.length === 0) {
    return "No price rules found.";
  }

  const now = new Date();
  const lines = rules.map((r) => {
    const isActive =
      new Date(r.starts_at) <= now && (!r.ends_at || new Date(r.ends_at) > now);
    const discountDisplay =
      r.value_type === "percentage"
        ? `${r.value}%`
        : `$${Math.abs(parseFloat(r.value)).toFixed(2)} off`;

    return [
      `**${r.title}** (ID: ${r.id})`,
      `  Status: ${isActive ? "ACTIVE" : "INACTIVE"} | Type: ${r.value_type}`,
      `  Discount: ${discountDisplay} | Target: ${r.target_type} (${r.target_selection})`,
      `  Starts: ${r.starts_at} | Ends: ${r.ends_at ?? "no end date"}`,
      `  Usage limit: ${r.usage_limit ?? "unlimited"} | Once per customer: ${r.once_per_customer ? "yes" : "no"}`,
    ].join("\n");
  });

  return `Found ${rules.length} price rule(s):\n\n${lines.join("\n\n")}`;
}

export async function getPriceRule(args: {
  price_rule_id: string;
}): Promise<string> {
  const client = getClient();

  const priceRuleId = sanitizeId(args.price_rule_id);
  const [ruleData, codesData] = await Promise.all([
    client.getData<{ price_rule: ShopifyPriceRule }>(
      `/price_rules/${priceRuleId}.json`,
    ),
    client.getData<{ discount_codes: ShopifyDiscountCode[] }>(
      `/price_rules/${priceRuleId}/discount_codes.json`,
    ),
  ]);

  const r = ruleData.price_rule;
  const codes = codesData.discount_codes;

  const now = new Date();
  const isActive =
    new Date(r.starts_at) <= now && (!r.ends_at || new Date(r.ends_at) > now);
  const discountDisplay =
    r.value_type === "percentage"
      ? `${r.value}%`
      : `$${Math.abs(parseFloat(r.value)).toFixed(2)} off`;

  const sections = [
    `# ${r.title} (ID: ${r.id})`,
    `Status: ${isActive ? "ACTIVE" : "INACTIVE"}`,
    ``,
    `## Discount`,
    `Type: ${r.value_type} | Value: ${discountDisplay}`,
    `Target: ${r.target_type} (${r.target_selection}) | Allocation: ${r.allocation_method}`,
    ``,
    `## Schedule`,
    `Starts: ${r.starts_at}`,
    `Ends: ${r.ends_at ?? "no end date"}`,
    ``,
    `## Limits`,
    `Usage limit: ${r.usage_limit ?? "unlimited"}`,
    `Once per customer: ${r.once_per_customer ? "yes" : "no"}`,
    ``,
    `## Entitlements`,
    r.entitled_product_ids.length > 0
      ? `Product IDs: ${r.entitled_product_ids.join(", ")}`
      : null,
    r.entitled_collection_ids.length > 0
      ? `Collection IDs: ${r.entitled_collection_ids.join(", ")}`
      : null,
    r.entitled_variant_ids.length > 0
      ? `Variant IDs: ${r.entitled_variant_ids.join(", ")}`
      : null,
    r.target_selection === "all" ? "Applies to: All products" : null,
    ``,
    `## Prerequisites`,
    r.prerequisite_subtotal_range
      ? `Min subtotal: $${r.prerequisite_subtotal_range.greater_than_or_equal_to}`
      : null,
    r.prerequisite_quantity_range
      ? `Min quantity: ${r.prerequisite_quantity_range.greater_than_or_equal_to}`
      : null,
    r.prerequisite_product_ids.length > 0
      ? `Prerequisite product IDs: ${r.prerequisite_product_ids.join(", ")}`
      : null,
    r.prerequisite_collection_ids.length > 0
      ? `Prerequisite collection IDs: ${r.prerequisite_collection_ids.join(", ")}`
      : null,
  ].filter(Boolean);

  // Discount codes
  if (codes.length > 0) {
    sections.push("", `## Discount Codes (${codes.length})`);
    for (const c of codes) {
      sections.push(
        `- **${c.code}** | Used: ${c.usage_count} times | Created: ${c.created_at}`,
      );
    }
  } else {
    sections.push("", "## Discount Codes", "No discount codes created yet.");
  }

  sections.push("", `Created: ${r.created_at} | Updated: ${r.updated_at}`);

  return sections.join("\n");
}

export async function createDiscountCode(args: {
  price_rule_id: string;
  code: string;
}): Promise<string> {
  const client = getClient();

  const priceRuleId = sanitizeId(args.price_rule_id);
  const result = await client.post<{ discount_code: ShopifyDiscountCode }>(
    `/price_rules/${priceRuleId}/discount_codes.json`,
    {
      discount_code: {
        code: args.code,
      },
    },
  );

  const c = result.data.discount_code;

  return [
    `Discount code created successfully!`,
    "",
    `Code: **${c.code}**`,
    `Price Rule ID: ${c.price_rule_id}`,
    `Discount Code ID: ${c.id}`,
    `Created: ${c.created_at}`,
  ].join("\n");
}

export async function listDiscountCodes(args: {
  price_rule_id: string;
}): Promise<string> {
  const client = getClient();

  const priceRuleId = sanitizeId(args.price_rule_id);
  const data = await client.getData<{ discount_codes: ShopifyDiscountCode[] }>(
    `/price_rules/${priceRuleId}/discount_codes.json`,
  );
  const codes = data.discount_codes;

  if (codes.length === 0) {
    return `No discount codes found for price rule ${args.price_rule_id}.`;
  }

  const lines = codes.map(
    (c) =>
      `- **${c.code}** (ID: ${c.id}) | Used: ${c.usage_count} times | Created: ${c.created_at}`,
  );

  return `Discount codes for price rule ${args.price_rule_id} (${codes.length}):\n\n${lines.join("\n")}`;
}
