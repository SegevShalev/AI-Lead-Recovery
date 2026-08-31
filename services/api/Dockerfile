FROM node:20-slim AS base
WORKDIR /workspace

FROM base AS build
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @ai-lead-recovery/api... run build

FROM node:20-slim
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace .
WORKDIR /workspace/services/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
