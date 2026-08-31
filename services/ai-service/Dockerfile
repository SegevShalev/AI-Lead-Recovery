FROM node:20-slim AS base
WORKDIR /workspace

FROM base AS build
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @ai-lead-recovery/ai-service... run build

FROM node:20-slim
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace .
WORKDIR /workspace/services/ai-service
EXPOSE 3001
CMD ["node", "dist/index.js"]
