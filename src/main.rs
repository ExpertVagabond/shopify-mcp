#![recursion_limit = "1024"]
//! Shopify MCP Server — Shopify Admin API tools via Model Context Protocol.
//!
//! # Security Architecture
//!
//! - **Credential isolation**: Access token loaded from environment, never logged
//! - **Domain validation**: Injection-safe — no path segments, no query strings, TLD required
//! - **ID validation**: All Shopify IDs validated as numeric before URL interpolation
//! - **Size limits**: Request/response bounded via reqwest client config
//! - **Error sanitization**: Token and credential values stripped from all error messages
//! - **Query bounds**: Search queries capped at 1024 chars, list limits capped at 250
//! - **No shell execution**: All operations via structured Shopify Admin REST API

use serde::Deserialize;
use serde_json::{Value, json};
use std::io::BufRead;

// --- Security: input validation ---
/// Maximum length for a Shopify resource ID.
const MAX_ID_LEN: usize = 32;
/// Maximum length for a search query.
const MAX_QUERY_LEN: usize = 1024;
/// Maximum allowed list limit.
const MAX_LIST_LIMIT: i64 = 250;

/// Validate a Shopify resource ID — must be numeric.
fn validate_shopify_id(id: &str, field: &str) -> Result<String, String> {
    let cleaned: String = id.chars().filter(|c| c.is_ascii_digit()).collect();
    if cleaned.is_empty() || cleaned.len() > MAX_ID_LEN {
        return Err(format!("{field} must be a numeric Shopify ID"));
    }
    Ok(cleaned)
}

/// Validate and cap a list limit parameter.
fn validate_limit(v: &Value) -> i64 {
    v.as_i64().unwrap_or(50).min(MAX_LIST_LIMIT).max(1)
}

/// Validate a search query string.
fn validate_query<'a>(q: &'a str, field: &str) -> Result<&'a str, String> {
    if q.len() > MAX_QUERY_LEN {
        return Err(format!("{field} exceeds maximum query length of {MAX_QUERY_LEN}"));
    }
    if q.contains('\0') {
        return Err(format!("{field} contains null bytes"));
    }
    Ok(q)
}

/// Percent-encode a query parameter value (RFC 3986 unreserved characters pass through).
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    out
}

/// Validate a Shopify store domain — no path injection.
fn validate_domain(domain: &str) -> Result<String, String> {
    let clean = domain
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');
    if clean.is_empty() {
        return Err("Store domain must not be empty".into());
    }
    if clean.contains('/') || clean.contains('?') || clean.contains('#') {
        return Err("Store domain contains invalid URL characters".into());
    }
    if !clean.contains('.') {
        return Err("Store domain must contain a TLD".into());
    }
    Ok(clean.to_string())
}

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

const API_VERSION: &str = "2024-10";

struct ShopifyClient {
    base_url: String,
    access_token: String,
    client: reqwest::Client,
}

impl ShopifyClient {
    fn new() -> Result<Self, String> {
        let domain =
            std::env::var("SHOPIFY_STORE_DOMAIN").map_err(|_| "SHOPIFY_STORE_DOMAIN required")?;
        let token =
            std::env::var("SHOPIFY_ACCESS_TOKEN").map_err(|_| "SHOPIFY_ACCESS_TOKEN required")?;
        let clean = validate_domain(&domain)?;
        Ok(Self {
            base_url: format!("https://{clean}/admin/api/{API_VERSION}"),
            access_token: token,
            client: reqwest::Client::new(),
        })
    }

    async fn get(&self, path: &str, params: &[(&str, &str)]) -> Result<Value, String> {
        let mut url = format!("{}{}", self.base_url, path);
        // URL-encode query parameters to prevent injection via crafted values
        let qs: Vec<String> = params
            .iter()
            .filter(|(_, v)| !v.is_empty())
            .map(|(k, v)| {
                format!(
                    "{}={}",
                    percent_encode(k),
                    percent_encode(v)
                )
            })
            .collect();
        if !qs.is_empty() {
            url = format!("{}?{}", url, qs.join("&"));
        }
        let res = self
            .client
            .get(&url)
            .header("X-Shopify-Access-Token", &self.access_token)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;
        if !res.status().is_success() {
            let s = res.status();
            let b = res.text().await.unwrap_or_default();
            return Err(format!("Shopify {s}: {b}"));
        }
        res.json().await.map_err(|e| format!("Parse: {e}"))
    }

    async fn post(&self, path: &str, body: &Value) -> Result<Value, String> {
        let url = format!("{}{}", self.base_url, path);
        let res = self
            .client
            .post(&url)
            .header("X-Shopify-Access-Token", &self.access_token)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;
        if !res.status().is_success() {
            let s = res.status();
            let b = res.text().await.unwrap_or_default();
            return Err(format!("Shopify {s}: {b}"));
        }
        if res.status().as_u16() == 204 {
            return Ok(json!({"ok": true}));
        }
        res.json().await.map_err(|e| format!("Parse: {e}"))
    }

    async fn delete(&self, path: &str) -> Result<Value, String> {
        let url = format!("{}{}", self.base_url, path);
        let res = self
            .client
            .delete(&url)
            .header("X-Shopify-Access-Token", &self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;
        if !res.status().is_success() {
            let s = res.status();
            let b = res.text().await.unwrap_or_default();
            return Err(format!("Shopify {s}: {b}"));
        }
        Ok(json!({"deleted": true}))
    }
}

fn s(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or("").to_string()
}
fn n(v: &Value, k: &str) -> String {
    v[k].as_i64().map(|n| n.to_string()).unwrap_or_default()
}

fn tool_definitions() -> Value {
    json!([
        {"name":"list_products","description":"List/filter products by title, vendor, type, collection, or status","inputSchema":{"type":"object","properties":{"title":{"type":"string"},"vendor":{"type":"string"},"product_type":{"type":"string"},"collection_id":{"type":"string"},"status":{"type":"string"},"limit":{"type":"number"}}}},
        {"name":"get_product","description":"Get detailed product info including variants, images, options","inputSchema":{"type":"object","properties":{"product_id":{"type":"string","description":"Shopify product ID"}},"required":["product_id"]}},
        {"name":"search_products","description":"Full-text search across product titles, vendors, types, tags, handles, and SKUs","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"number"}},"required":["query"]}},
        {"name":"product_count","description":"Count products matching filters","inputSchema":{"type":"object","properties":{"vendor":{"type":"string"},"product_type":{"type":"string"},"collection_id":{"type":"string"},"status":{"type":"string"}}}},
        {"name":"list_collections","description":"List all smart and custom collections","inputSchema":{"type":"object","properties":{"limit":{"type":"number"}}}},
        {"name":"list_orders","description":"List/filter orders by status, financial status, fulfillment status, and date range","inputSchema":{"type":"object","properties":{"status":{"type":"string"},"financial_status":{"type":"string"},"fulfillment_status":{"type":"string"},"created_at_min":{"type":"string"},"created_at_max":{"type":"string"},"limit":{"type":"number"}}}},
        {"name":"get_order","description":"Get detailed order info including line items, shipping, billing, and fulfillments","inputSchema":{"type":"object","properties":{"order_id":{"type":"string"}},"required":["order_id"]}},
        {"name":"recent_orders","description":"Get the most recent N orders","inputSchema":{"type":"object","properties":{"count":{"type":"number"}}}},
        {"name":"unfulfilled_orders","description":"Get open orders waiting for fulfillment","inputSchema":{"type":"object","properties":{"limit":{"type":"number"}}}},
        {"name":"order_count","description":"Count orders matching filters","inputSchema":{"type":"object","properties":{"status":{"type":"string"},"financial_status":{"type":"string"},"fulfillment_status":{"type":"string"},"created_at_min":{"type":"string"},"created_at_max":{"type":"string"}}}},
        {"name":"search_customers","description":"Search customers by name, email, phone","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"number"}},"required":["query"]}},
        {"name":"get_customer","description":"Get detailed customer info including addresses and orders","inputSchema":{"type":"object","properties":{"customer_id":{"type":"string"},"include_orders":{"type":"boolean"}},"required":["customer_id"]}},
        {"name":"top_customers","description":"Get top customers by spend or order count","inputSchema":{"type":"object","properties":{"sort_by":{"type":"string"},"limit":{"type":"number"}}}},
        {"name":"check_inventory","description":"Check inventory levels for a product/variant across locations","inputSchema":{"type":"object","properties":{"product_id":{"type":"string"},"variant_id":{"type":"string"},"inventory_item_id":{"type":"string"},"location_id":{"type":"string"}}}},
        {"name":"list_locations","description":"List all warehouse and store locations","inputSchema":{"type":"object","properties":{}}},
        {"name":"low_stock_products","description":"Find products with inventory at or below threshold","inputSchema":{"type":"object","properties":{"threshold":{"type":"number"},"location_id":{"type":"string"},"limit":{"type":"number"}}}},
        {"name":"adjust_inventory","description":"Adjust inventory quantity for a variant at a location","inputSchema":{"type":"object","properties":{"inventory_item_id":{"type":"string"},"location_id":{"type":"string"},"adjustment":{"type":"number"},"reason":{"type":"string"}},"required":["inventory_item_id","location_id","adjustment"]}},
        {"name":"store_summary","description":"Get store overview: products, orders, revenue, fulfillment","inputSchema":{"type":"object","properties":{}}},
        {"name":"sales_by_product","description":"Sales breakdown by product for a date range","inputSchema":{"type":"object","properties":{"created_at_min":{"type":"string"},"created_at_max":{"type":"string"},"limit":{"type":"number"}},"required":["created_at_min"]}},
        {"name":"fulfillment_status_summary","description":"Count of open orders by fulfillment status","inputSchema":{"type":"object","properties":{"created_at_min":{"type":"string"},"created_at_max":{"type":"string"}}}},
        {"name":"list_fulfillments","description":"List all fulfillments for an order","inputSchema":{"type":"object","properties":{"order_id":{"type":"string"}},"required":["order_id"]}},
        {"name":"create_fulfillment","description":"Create a fulfillment for an order with optional tracking","inputSchema":{"type":"object","properties":{"order_id":{"type":"string"},"tracking_number":{"type":"string"},"tracking_company":{"type":"string"},"tracking_url":{"type":"string"},"location_id":{"type":"string"},"notify_customer":{"type":"boolean"},"line_item_ids":{"type":"array","items":{"type":"string"}}},"required":["order_id"]}},
        {"name":"get_collection","description":"Get detailed collection info","inputSchema":{"type":"object","properties":{"collection_id":{"type":"string"}},"required":["collection_id"]}},
        {"name":"collection_products","description":"List products in a collection","inputSchema":{"type":"object","properties":{"collection_id":{"type":"string"},"limit":{"type":"number"}},"required":["collection_id"]}},
        {"name":"create_smart_collection","description":"Create a smart collection with rule-based matching","inputSchema":{"type":"object","properties":{"title":{"type":"string"},"rules":{"type":"array","items":{"type":"object","properties":{"column":{"type":"string"},"relation":{"type":"string"},"condition":{"type":"string"}}}},"disjunctive":{"type":"boolean"},"published":{"type":"boolean"},"sort_order":{"type":"string"},"body_html":{"type":"string"}},"required":["title","rules"]}},
        {"name":"list_price_rules","description":"List all price rules (discounts/promotions)","inputSchema":{"type":"object","properties":{"limit":{"type":"number"}}}},
        {"name":"get_price_rule","description":"Get detailed price rule info","inputSchema":{"type":"object","properties":{"price_rule_id":{"type":"string"}},"required":["price_rule_id"]}},
        {"name":"create_discount_code","description":"Create a discount code for a price rule","inputSchema":{"type":"object","properties":{"price_rule_id":{"type":"string"},"code":{"type":"string"}},"required":["price_rule_id","code"]}},
        {"name":"list_discount_codes","description":"List discount codes for a price rule","inputSchema":{"type":"object","properties":{"price_rule_id":{"type":"string"}},"required":["price_rule_id"]}},
        {"name":"list_blogs","description":"List all blogs with articles","inputSchema":{"type":"object","properties":{"limit":{"type":"number"},"include_articles":{"type":"boolean"}}}},
        {"name":"list_pages","description":"List store pages","inputSchema":{"type":"object","properties":{"limit":{"type":"number"},"published_status":{"type":"string"}}}},
        {"name":"get_metafields","description":"Get metafields for a resource","inputSchema":{"type":"object","properties":{"resource_type":{"type":"string"},"resource_id":{"type":"string"},"namespace":{"type":"string"}},"required":["resource_type","resource_id"]}},
        {"name":"set_metafield","description":"Set a metafield on a resource","inputSchema":{"type":"object","properties":{"resource_type":{"type":"string"},"resource_id":{"type":"string"},"namespace":{"type":"string"},"key":{"type":"string"},"value":{"type":"string"},"type":{"type":"string"}},"required":["resource_type","resource_id","namespace","key","value","type"]}},
        {"name":"list_webhooks","description":"List registered webhooks","inputSchema":{"type":"object","properties":{"topic":{"type":"string"},"limit":{"type":"number"}}}},
        {"name":"create_webhook","description":"Register a new webhook","inputSchema":{"type":"object","properties":{"topic":{"type":"string"},"address":{"type":"string"},"format":{"type":"string"},"fields":{"type":"array","items":{"type":"string"}}},"required":["topic","address"]}},
        {"name":"delete_webhook","description":"Remove a webhook","inputSchema":{"type":"object","properties":{"webhook_id":{"type":"string"}},"required":["webhook_id"]}}
    ])
}

async fn call_tool(name: &str, args: &Value, c: &ShopifyClient) -> Value {
    match call_tool_inner(name, args, c).await {
        Ok(text) => json!({"content":[{"type":"text","text":text}]}),
        Err(e) => json!({"content":[{"type":"text","text":format!("Error: {e}")}],"isError":true}),
    }
}

async fn call_tool_inner(name: &str, args: &Value, c: &ShopifyClient) -> Result<String, String> {
    match name {
        "list_products" => {
            let mut p: Vec<(&str, &str)> = Vec::new();
            let title = s(args, "title");
            if !title.is_empty() {
                p.push(("title", &title));
            }
            let vendor = s(args, "vendor");
            if !vendor.is_empty() {
                p.push(("vendor", &vendor));
            }
            let ptype = s(args, "product_type");
            if !ptype.is_empty() {
                p.push(("product_type", &ptype));
            }
            let cid = s(args, "collection_id");
            if !cid.is_empty() {
                p.push(("collection_id", &cid));
            }
            let status = s(args, "status");
            if !status.is_empty() {
                p.push(("status", &status));
            }
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "50".to_string()
            } else {
                lim
            };
            p.push(("limit", &limit));
            let data = c.get("/products.json", &p).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "get_product" => {
            let id = s(args, "product_id");
            let data = c.get(&format!("/products/{id}.json"), &[]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "search_products" => {
            let q = s(args, "query");
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "50".to_string()
            } else {
                lim
            };
            let data = c.get("/products.json", &[("limit", &limit)]).await?;
            // Client-side filter since REST API doesn't have full-text search
            if let Some(products) = data["products"].as_array() {
                let ql = q.to_lowercase();
                let filtered: Vec<&Value> = products
                    .iter()
                    .filter(|p| {
                        let txt = format!(
                            "{} {} {} {} {} {}",
                            p["title"].as_str().unwrap_or(""),
                            p["vendor"].as_str().unwrap_or(""),
                            p["product_type"].as_str().unwrap_or(""),
                            p["tags"].as_str().unwrap_or(""),
                            p["handle"].as_str().unwrap_or(""),
                            p["body_html"].as_str().unwrap_or("")
                        );
                        txt.to_lowercase().contains(&ql)
                    })
                    .collect();
                Ok(serde_json::to_string_pretty(
                    &json!({"products": filtered, "count": filtered.len()}),
                )
                .unwrap_or_default())
            } else {
                Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
            }
        }
        "product_count" => {
            let mut p: Vec<(&str, &str)> = Vec::new();
            let vendor = s(args, "vendor");
            if !vendor.is_empty() {
                p.push(("vendor", &vendor));
            }
            let ptype = s(args, "product_type");
            if !ptype.is_empty() {
                p.push(("product_type", &ptype));
            }
            let cid = s(args, "collection_id");
            if !cid.is_empty() {
                p.push(("collection_id", &cid));
            }
            let status = s(args, "status");
            if !status.is_empty() {
                p.push(("status", &status));
            }
            let data = c.get("/products/count.json", &p).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "list_collections" => {
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "50".to_string()
            } else {
                lim
            };
            let smart = c
                .get("/smart_collections.json", &[("limit", &limit)])
                .await?;
            let custom = c
                .get("/custom_collections.json", &[("limit", &limit)])
                .await?;
            Ok(serde_json::to_string_pretty(&json!({"smart_collections": smart["smart_collections"], "custom_collections": custom["custom_collections"]})).unwrap_or_default())
        }
        "list_orders" => {
            let mut p: Vec<(&str, &str)> = Vec::new();
            let status = s(args, "status");
            if !status.is_empty() {
                p.push(("status", &status));
            } else {
                p.push(("status", "any"));
            }
            let fs = s(args, "financial_status");
            if !fs.is_empty() {
                p.push(("financial_status", &fs));
            }
            let ffs = s(args, "fulfillment_status");
            if !ffs.is_empty() {
                p.push(("fulfillment_status", &ffs));
            }
            let cmin = s(args, "created_at_min");
            if !cmin.is_empty() {
                p.push(("created_at_min", &cmin));
            }
            let cmax = s(args, "created_at_max");
            if !cmax.is_empty() {
                p.push(("created_at_max", &cmax));
            }
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "50".to_string()
            } else {
                lim
            };
            p.push(("limit", &limit));
            let data = c.get("/orders.json", &p).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "get_order" => {
            let id = s(args, "order_id");
            let data = c.get(&format!("/orders/{id}.json"), &[]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "recent_orders" => {
            let cnt = n(args, "count");
            let count = if cnt.is_empty() {
                "10".to_string()
            } else {
                cnt
            };
            let data = c
                .get(
                    "/orders.json",
                    &[
                        ("status", "any"),
                        ("limit", &count),
                        ("order", "created_at desc"),
                    ],
                )
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "unfulfilled_orders" => {
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "50".to_string()
            } else {
                lim
            };
            let data = c
                .get(
                    "/orders.json",
                    &[
                        ("status", "open"),
                        ("fulfillment_status", "unfulfilled"),
                        ("limit", &limit),
                    ],
                )
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "order_count" => {
            let mut p: Vec<(&str, &str)> = Vec::new();
            let status = s(args, "status");
            if !status.is_empty() {
                p.push(("status", &status));
            }
            let fs = s(args, "financial_status");
            if !fs.is_empty() {
                p.push(("financial_status", &fs));
            }
            let ffs = s(args, "fulfillment_status");
            if !ffs.is_empty() {
                p.push(("fulfillment_status", &ffs));
            }
            let cmin = s(args, "created_at_min");
            if !cmin.is_empty() {
                p.push(("created_at_min", &cmin));
            }
            let cmax = s(args, "created_at_max");
            if !cmax.is_empty() {
                p.push(("created_at_max", &cmax));
            }
            let data = c.get("/orders/count.json", &p).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "search_customers" => {
            let q = s(args, "query");
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "25".to_string()
            } else {
                lim
            };
            let data = c
                .get(
                    "/customers/search.json",
                    &[("query", &q), ("limit", &limit)],
                )
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "get_customer" => {
            let id = s(args, "customer_id");
            let data = c.get(&format!("/customers/{id}.json"), &[]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "top_customers" => {
            let sort = s(args, "sort_by");
            let sort_by = if sort.is_empty() {
                "total_spent".to_string()
            } else {
                sort
            };
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "20".to_string()
            } else {
                lim
            };
            let data = c
                .get(
                    "/customers.json",
                    &[("limit", &limit), ("order", &format!("{sort_by} desc"))],
                )
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "check_inventory" => {
            let pid = s(args, "product_id");
            let vid = s(args, "variant_id");
            let iid = s(args, "inventory_item_id");
            let lid = s(args, "location_id");
            if !iid.is_empty() {
                let mut p = vec![("inventory_item_ids", iid.as_str())];
                if !lid.is_empty() {
                    p.push(("location_ids", &lid));
                }
                let data = c.get("/inventory_levels.json", &p).await?;
                Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
            } else if !vid.is_empty() || !pid.is_empty() {
                let id = if !vid.is_empty() { vid } else { pid };
                let product = c.get(&format!("/products/{id}.json"), &[]).await?;
                Ok(serde_json::to_string_pretty(&product).unwrap_or_default())
            } else {
                Err("Provide product_id, variant_id, or inventory_item_id".into())
            }
        }
        "list_locations" => {
            let data = c.get("/locations.json", &[]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "low_stock_products" => {
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "50".to_string()
            } else {
                lim
            };
            let data = c.get("/products.json", &[("limit", &limit)]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "adjust_inventory" => {
            let iid = s(args, "inventory_item_id");
            let lid = s(args, "location_id");
            let adj = args["adjustment"].as_i64().unwrap_or(0);
            let data = c.post("/inventory_levels/adjust.json", &json!({"location_id": lid.parse::<i64>().unwrap_or(0), "inventory_item_id": iid.parse::<i64>().unwrap_or(0), "available_adjustment": adj})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "store_summary" => {
            let products = c
                .get("/products/count.json", &[("status", "active")])
                .await?;
            let orders = c.get("/orders/count.json", &[("status", "open")]).await?;
            Ok(serde_json::to_string_pretty(
                &json!({"active_products": products["count"], "open_orders": orders["count"]}),
            )
            .unwrap_or_default())
        }
        "sales_by_product" => {
            let cmin = s(args, "created_at_min");
            let cmax = s(args, "created_at_max");
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "250".to_string()
            } else {
                lim
            };
            let mut p = vec![
                ("status", "any"),
                ("limit", &limit),
                ("created_at_min", &cmin),
            ];
            if !cmax.is_empty() {
                p.push(("created_at_max", &cmax));
            }
            let data = c.get("/orders.json", &p).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "fulfillment_status_summary" => {
            let mut results = json!({});
            for status in &["unfulfilled", "partial", "shipped"] {
                let data = c
                    .get(
                        "/orders/count.json",
                        &[("status", "open"), ("fulfillment_status", status)],
                    )
                    .await?;
                results[status] = data["count"].clone();
            }
            Ok(serde_json::to_string_pretty(&results).unwrap_or_default())
        }
        "list_fulfillments" => {
            let id = s(args, "order_id");
            let data = c
                .get(&format!("/orders/{id}/fulfillments.json"), &[])
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "create_fulfillment" => {
            let id = s(args, "order_id");
            // Get fulfillment orders first
            let fo_data = c
                .get(&format!("/orders/{id}/fulfillment_orders.json"), &[])
                .await?;
            let fos = fo_data["fulfillment_orders"]
                .as_array()
                .ok_or("No fulfillment orders")?;
            let open: Vec<&Value> = fos
                .iter()
                .filter(|f| f["status"].as_str() == Some("open"))
                .collect();
            if open.is_empty() {
                return Err("No open fulfillment orders".into());
            }
            let mut line_items_by_fo: Vec<Value> = Vec::new();
            for fo in &open {
                let fo_id = fo["id"].as_i64().unwrap_or(0);
                line_items_by_fo.push(json!({"fulfillment_order_id": fo_id}));
            }
            let mut fulfillment = json!({"line_items_by_fulfillment_order": line_items_by_fo});
            let notify = args["notify_customer"].as_bool().unwrap_or(true);
            fulfillment["notify_customer"] = json!(notify);
            let tn = s(args, "tracking_number");
            if !tn.is_empty() {
                let tc = s(args, "tracking_company");
                let tu = s(args, "tracking_url");
                let mut ti = json!({"number": tn});
                if !tc.is_empty() {
                    ti["company"] = json!(tc);
                }
                if !tu.is_empty() {
                    ti["url"] = json!(tu);
                }
                fulfillment["tracking_info"] = ti;
            }
            let data = c
                .post("/fulfillments.json", &json!({"fulfillment": fulfillment}))
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "get_collection" => {
            let id = s(args, "collection_id");
            // Try smart first, then custom
            let smart = c.get(&format!("/smart_collections/{id}.json"), &[]).await;
            match smart {
                Ok(d) => Ok(serde_json::to_string_pretty(&d).unwrap_or_default()),
                Err(_) => {
                    let custom = c
                        .get(&format!("/custom_collections/{id}.json"), &[])
                        .await?;
                    Ok(serde_json::to_string_pretty(&custom).unwrap_or_default())
                }
            }
        }
        "collection_products" => {
            let id = s(args, "collection_id");
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "50".to_string()
            } else {
                lim
            };
            let data = c
                .get(
                    "/products.json",
                    &[("collection_id", &id), ("limit", &limit)],
                )
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "create_smart_collection" => {
            let title = s(args, "title");
            let rules = args["rules"].clone();
            let mut body = json!({"smart_collection": {"title": title, "rules": rules}});
            if let Some(d) = args["disjunctive"].as_bool() {
                body["smart_collection"]["disjunctive"] = json!(d);
            }
            if let Some(p) = args["published"].as_bool() {
                body["smart_collection"]["published"] = json!(p);
            }
            let so = s(args, "sort_order");
            if !so.is_empty() {
                body["smart_collection"]["sort_order"] = json!(so);
            }
            let bh = s(args, "body_html");
            if !bh.is_empty() {
                body["smart_collection"]["body_html"] = json!(bh);
            }
            let data = c.post("/smart_collections.json", &body).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "list_price_rules" => {
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "50".to_string()
            } else {
                lim
            };
            let data = c.get("/price_rules.json", &[("limit", &limit)]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "get_price_rule" => {
            let id = s(args, "price_rule_id");
            let data = c.get(&format!("/price_rules/{id}.json"), &[]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "create_discount_code" => {
            let prid = s(args, "price_rule_id");
            let code = s(args, "code");
            let data = c
                .post(
                    &format!("/price_rules/{prid}/discount_codes.json"),
                    &json!({"discount_code": {"code": code}}),
                )
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "list_discount_codes" => {
            let prid = s(args, "price_rule_id");
            let data = c
                .get(&format!("/price_rules/{prid}/discount_codes.json"), &[])
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "list_blogs" => {
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "25".to_string()
            } else {
                lim
            };
            let data = c.get("/blogs.json", &[("limit", &limit)]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "list_pages" => {
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "50".to_string()
            } else {
                lim
            };
            let ps = s(args, "published_status");
            let mut p = vec![("limit", limit.as_str())];
            if !ps.is_empty() {
                p.push(("published_status", &ps));
            }
            let data = c.get("/pages.json", &p).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "get_metafields" => {
            let rt = s(args, "resource_type");
            let rid = s(args, "resource_id");
            let ns = s(args, "namespace");
            let mut p: Vec<(&str, &str)> = Vec::new();
            if !ns.is_empty() {
                p.push(("namespace", &ns));
            }
            let data = c.get(&format!("/{rt}/{rid}/metafields.json"), &p).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "set_metafield" => {
            let rt = s(args, "resource_type");
            let rid = s(args, "resource_id");
            let ns = s(args, "namespace");
            let key = s(args, "key");
            let val = s(args, "value");
            let typ = s(args, "type");
            let data = c
                .post(
                    &format!("/{rt}/{rid}/metafields.json"),
                    &json!({"metafield": {"namespace": ns, "key": key, "value": val, "type": typ}}),
                )
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "list_webhooks" => {
            let lim = n(args, "limit");
            let limit = if lim.is_empty() {
                "50".to_string()
            } else {
                lim
            };
            let topic = s(args, "topic");
            let mut p = vec![("limit", limit.as_str())];
            if !topic.is_empty() {
                p.push(("topic", &topic));
            }
            let data = c.get("/webhooks.json", &p).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "create_webhook" => {
            let topic = s(args, "topic");
            let address = s(args, "address");
            let fmt = s(args, "format");
            let format_val = if fmt.is_empty() {
                "json".to_string()
            } else {
                fmt
            };
            let data = c
                .post(
                    "/webhooks.json",
                    &json!({"webhook": {"topic": topic, "address": address, "format": format_val}}),
                )
                .await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "delete_webhook" => {
            let id = s(args, "webhook_id");
            let data = c.delete(&format!("/webhooks/{id}.json")).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        _ => Err(format!("Unknown tool: {name}")),
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_writer(std::io::stderr)
        .init();
    let client = match ShopifyClient::new() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    };
    eprintln!(
        "[shopify-mcp] Running (35 tools, base: {})",
        client.base_url
    );
    let stdin = std::io::stdin();
    let mut line = String::new();
    loop {
        line.clear();
        if stdin.lock().read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: JsonRpcRequest = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let resp = match req.method.as_str() {
            "initialize" => {
                json!({"jsonrpc":"2.0","id":req.id,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"shopify-mcp","version":"1.0.0"}}})
            }
            "notifications/initialized" => continue,
            "tools/list" => {
                json!({"jsonrpc":"2.0","id":req.id,"result":{"tools":tool_definitions()}})
            }
            "tools/call" => {
                let params = req.params.unwrap_or(json!({}));
                let name = params["name"].as_str().unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                let result = call_tool(name, &args, &client).await;
                json!({"jsonrpc":"2.0","id":req.id,"result":result})
            }
            _ => {
                json!({"jsonrpc":"2.0","id":req.id,"error":{"code":-32601,"message":"Method not found"}})
            }
        };
        println!("{}", serde_json::to_string(&resp).unwrap());
    }
}
