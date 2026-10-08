# Build multi-stage pour @erp/api (voir ARCHITECTURE.md section 22).
FROM node:20-alpine AS base
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json

FROM base AS deps
RUN npm install --workspaces --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/database packages/database
COPY apps/api apps/api
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
RUN npm run build:api

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
# Requis par le moteur Prisma (binaryTarget linux-musl-openssl-3.0.x) -- sans lui le process
# plante au demarrage avec "Error loading shared library libssl.so.1.1: No such file or directory".
RUN apk add --no-cache openssl
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/database ./packages/database
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
