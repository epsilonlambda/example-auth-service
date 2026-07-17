FROM node:24.18.0-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

COPY src ./src

ENV PORT=3000
EXPOSE 3000
USER node

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "src/healthcheck.ts"]

CMD ["node", "src/server.ts"]
