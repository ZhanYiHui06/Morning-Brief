FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@morning-brief/server", "start"]
