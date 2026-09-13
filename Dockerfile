FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html ./
COPY src ./src
COPY styles ./styles
COPY scripts/build.mjs ./scripts/build.mjs
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY scripts/serve.mjs ./serve.mjs
USER node
EXPOSE 4173
CMD ["node", "/app/serve.mjs"]
