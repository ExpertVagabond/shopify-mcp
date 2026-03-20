/**
 * Webhook management tools for Shopify Admin API.
 */

import { getClient, sanitizeId } from "../api.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyWebhook {
  id: number;
  address: string;
  topic: string;
  format: string;
  created_at: string;
  updated_at: string;
  fields: string[];
  metafield_namespaces: string[];
  api_version: string;
}

// ── Tool implementations ─────────────────────────────────────────────────────

export async function listWebhooks(args: {
  topic?: string;
  limit?: number;
}): Promise<string> {
  const client = getClient();

  const params: Record<string, string | number | boolean> = {
    limit: args.limit ?? 50,
  };
  if (args.topic) {
    params.topic = args.topic;
  }

  const data = await client.getData<{ webhooks: ShopifyWebhook[] }>(
    "/webhooks.json",
    params,
  );
  const webhooks = data.webhooks;

  if (webhooks.length === 0) {
    return args.topic
      ? `No webhooks found for topic "${args.topic}".`
      : "No webhooks registered.";
  }

  const lines = webhooks.map((w) =>
    [
      `**${w.topic}** (ID: ${w.id})`,
      `  Address: ${w.address}`,
      `  Format: ${w.format} | API Version: ${w.api_version}`,
      w.fields.length > 0 ? `  Fields: ${w.fields.join(", ")}` : null,
      w.metafield_namespaces.length > 0
        ? `  Metafield namespaces: ${w.metafield_namespaces.join(", ")}`
        : null,
      `  Created: ${w.created_at} | Updated: ${w.updated_at}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return `Registered webhooks (${webhooks.length}):\n\n${lines.join("\n\n")}`;
}

export async function createWebhook(args: {
  topic: string;
  address: string;
  format?: string;
  fields?: string[];
}): Promise<string> {
  // Validate webhook address is a valid HTTPS URL
  try {
    const url = new URL(args.address);
    if (url.protocol !== "https:") {
      return "Error: Webhook address must use HTTPS protocol";
    }
  } catch {
    return "Error: Webhook address must be a valid URL";
  }

  const client = getClient();

  const body: Record<string, unknown> = {
    webhook: {
      topic: args.topic,
      address: args.address,
      format: args.format ?? "json",
      ...(args.fields && args.fields.length > 0
        ? { fields: args.fields }
        : {}),
    },
  };

  const result = await client.post<{ webhook: ShopifyWebhook }>(
    "/webhooks.json",
    body,
  );

  const w = result.data.webhook;

  return [
    `Webhook created successfully!`,
    "",
    `Topic: ${w.topic}`,
    `Address: ${w.address}`,
    `Format: ${w.format}`,
    `API Version: ${w.api_version}`,
    `Webhook ID: ${w.id}`,
    w.fields.length > 0 ? `Fields: ${w.fields.join(", ")}` : null,
    `Created: ${w.created_at}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function deleteWebhook(args: {
  webhook_id: string;
}): Promise<string> {
  const id = sanitizeId(args.webhook_id);
  const client = getClient();

  // First get the webhook details for confirmation
  let webhookInfo = "";
  try {
    const data = await client.getData<{ webhook: ShopifyWebhook }>(
      `/webhooks/${id}.json`,
    );
    webhookInfo = ` (topic: ${data.webhook.topic}, address: ${data.webhook.address})`;
  } catch {
    // Webhook may not exist
  }

  await client.delete(`/webhooks/${id}.json`);

  return `Webhook ${args.webhook_id}${webhookInfo} deleted successfully.`;
}
