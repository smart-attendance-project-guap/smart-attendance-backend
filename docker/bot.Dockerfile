FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=bot_source /package.json /package-lock.json ./
RUN npm ci
COPY --from=bot_source /tsconfig.json ./
COPY --from=bot_source /src ./src
RUN npm run build
CMD ["node", "dist/index.js"]
