/**
 * Content tools — blogs, pages, metafields
 * for Shopify Admin API.
 */

import { getClient, sanitizeId } from "../api.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyBlog {
  id: number;
  title: string;
  handle: string;
  commentable: string;
  created_at: string;
  updated_at: string;
  tags: string;
}

interface ShopifyArticle {
  id: number;
  title: string;
  author: string;
  body_html: string | null;
  blog_id: number;
  handle: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  summary_html: string | null;
  tags: string;
}

interface ShopifyPage {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  author: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  template_suffix: string | null;
}

interface ShopifyMetafield {
  id: number;
  namespace: string;
  key: string;
  value: string;
  type: string;
  owner_id: number;
  owner_resource: string;
  created_at: string;
  updated_at: string;
}

// ── Tool implementations ─────────────────────────────────────────────────────

export async function listBlogs(args: {
  limit?: number;
  include_articles?: boolean;
}): Promise<string> {
  const client = getClient();

  const data = await client.getData<{ blogs: ShopifyBlog[] }>("/blogs.json", {
    limit: args.limit ?? 25,
  });
  const blogs = data.blogs;

  if (blogs.length === 0) {
    return "No blogs found.";
  }

  const sections: string[] = [];

  for (const blog of blogs) {
    const blogLines = [
      `**${blog.title}** (ID: ${blog.id})`,
      `  Handle: ${blog.handle} | Comments: ${blog.commentable}`,
      `  Created: ${blog.created_at} | Updated: ${blog.updated_at}`,
    ];

    // Optionally fetch articles for each blog
    if (args.include_articles !== false) {
      try {
        const blogId = sanitizeId(blog.id);
        const articleData = await client.getData<{ articles: ShopifyArticle[] }>(
          `/blogs/${blogId}/articles.json`,
          { limit: 10, fields: "id,title,author,published_at,tags,handle" },
        );
        const articles = articleData.articles;

        if (articles.length > 0) {
          blogLines.push(`  Articles (${articles.length}):`);
          for (const a of articles) {
            blogLines.push(
              `    - ${a.title} (ID: ${a.id}) | Author: ${a.author} | Published: ${a.published_at ?? "draft"} | Tags: ${a.tags || "none"}`,
            );
          }
        } else {
          blogLines.push("  Articles: none");
        }
      } catch {
        blogLines.push("  (Could not fetch articles)");
      }
    }

    sections.push(blogLines.join("\n"));
  }

  return `Found ${blogs.length} blog(s):\n\n${sections.join("\n\n")}`;
}

export async function listPages(args: {
  limit?: number;
  published_status?: string;
}): Promise<string> {
  const client = getClient();

  const params: Record<string, string | number | boolean> = {
    limit: args.limit ?? 50,
  };
  if (args.published_status) {
    params.published_status = args.published_status;
  }

  const data = await client.getData<{ pages: ShopifyPage[] }>(
    "/pages.json",
    params,
  );
  const pages = data.pages;

  if (pages.length === 0) {
    return "No pages found.";
  }

  const lines = pages.map((p) => {
    const bodyPreview = p.body_html
      ? p.body_html.replace(/<[^>]*>/g, "").slice(0, 100)
      : "N/A";
    return [
      `**${p.title}** (ID: ${p.id})`,
      `  Handle: ${p.handle} | Author: ${p.author}`,
      `  Published: ${p.published_at ?? "draft"}`,
      `  Template: ${p.template_suffix ?? "default"}`,
      `  Preview: ${bodyPreview}${bodyPreview.length >= 100 ? "..." : ""}`,
    ].join("\n");
  });

  return `Found ${pages.length} page(s):\n\n${lines.join("\n\n")}`;
}

export async function getMetafields(args: {
  resource_type: string;
  resource_id: string;
  namespace?: string;
}): Promise<string> {
  const client = getClient();

  // Build the path based on resource type
  // Supported: products, customers, orders, collections, pages, blogs, articles, variants
  const validResources = [
    "products",
    "customers",
    "orders",
    "collections",
    "pages",
    "blogs",
    "articles",
    "variants",
  ];

  if (!validResources.includes(args.resource_type)) {
    return `Invalid resource type "${args.resource_type}". Valid types: ${validResources.join(", ")}`;
  }

  const params: Record<string, string | number | boolean> = {};
  if (args.namespace) {
    params.namespace = args.namespace;
  }

  const resourceId = sanitizeId(args.resource_id);
  const data = await client.getData<{ metafields: ShopifyMetafield[] }>(
    `/${args.resource_type}/${resourceId}/metafields.json`,
    params,
  );
  const metafields = data.metafields;

  if (metafields.length === 0) {
    return `No metafields found for ${args.resource_type} ${args.resource_id}${args.namespace ? ` in namespace "${args.namespace}"` : ""}.`;
  }

  const lines = metafields.map(
    (mf) =>
      `- **${mf.namespace}.${mf.key}** (ID: ${mf.id})\n  Type: ${mf.type} | Value: ${mf.value.length > 200 ? mf.value.slice(0, 200) + "..." : mf.value}\n  Updated: ${mf.updated_at}`,
  );

  return `Metafields for ${args.resource_type} ${args.resource_id} (${metafields.length}):\n\n${lines.join("\n\n")}`;
}

export async function setMetafield(args: {
  resource_type: string;
  resource_id: string;
  namespace: string;
  key: string;
  value: string;
  type: string;
}): Promise<string> {
  const client = getClient();

  const validResources = [
    "products",
    "customers",
    "orders",
    "collections",
    "pages",
    "blogs",
    "articles",
    "variants",
  ];

  if (!validResources.includes(args.resource_type)) {
    return `Invalid resource type "${args.resource_type}". Valid types: ${validResources.join(", ")}`;
  }

  const resourceId = sanitizeId(args.resource_id);
  const result = await client.post<{ metafield: ShopifyMetafield }>(
    `/${args.resource_type}/${resourceId}/metafields.json`,
    {
      metafield: {
        namespace: args.namespace,
        key: args.key,
        value: args.value,
        type: args.type,
      },
    },
  );

  const mf = result.data.metafield;

  return [
    `Metafield set successfully!`,
    "",
    `Resource: ${args.resource_type} ${args.resource_id}`,
    `Key: ${mf.namespace}.${mf.key}`,
    `Type: ${mf.type}`,
    `Value: ${mf.value}`,
    `ID: ${mf.id}`,
    `Created: ${mf.created_at}`,
  ].join("\n");
}
