FROM node:24-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=frontend_source /package.json /package-lock.json ./
RUN npm ci
COPY --from=frontend_source /tsconfig.json /next.config.ts ./
COPY --from=frontend_source /app ./app
COPY --from=frontend_source /public ./public
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build
EXPOSE 3001
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3001"]
