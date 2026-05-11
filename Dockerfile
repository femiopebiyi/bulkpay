FROM rust:1.95-slim as builder

WORKDIR /app

COPY . .

RUN apt-get update && apt-get install -y pkg-config libssl-dev libpq-dev

RUN cd packages/backend && cargo build --release

FROM debian:bookworm-slim

WORKDIR /app

COPY --from=builder /app/packages/backend/target/release/bulkpay-backend ./bulkpay-backend

RUN apt-get update && apt-get install -y libpq5 ca-certificates && rm -rf /var/lib/apt/lists/*

EXPOSE 3001
CMD ["./bulkpay-backend"]
