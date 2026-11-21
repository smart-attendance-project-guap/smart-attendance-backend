FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma7.config.ts tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx prisma generate --config prisma7.config.ts && npm run build
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy --config prisma7.config.ts && exec node dist/server.js"]
