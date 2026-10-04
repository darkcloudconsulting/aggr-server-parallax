FROM node:22.15.0-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22.15.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src
COPY scripts/repair-okx-launch.js ./scripts/repair-okx-launch.js
COPY index.js ecosystem.config.js config.parallax.json ./
RUN mkdir -p /app/products /var/lib/aggr-journal && chown -R node:node /app /var/lib/aggr-journal
USER node
ENV RUNNING_IN_DOCKER=true PM2_HOME=/tmp/pm2
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./node_modules/.bin/pm2-runtime", "ecosystem.config.js"]
