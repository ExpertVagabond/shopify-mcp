FROM rust:1.82-alpine AS builder
RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static
WORKDIR /app
COPY . .
RUN cargo build --release

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/target/release/shopify-mcp /usr/local/bin/
ENTRYPOINT ["shopify-mcp"]
