FROM node:20-bullseye-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/package.json

RUN npm ci --workspace=apps/frontend --include-workspace-root

COPY apps/frontend apps/frontend

RUN npm run build --workspace=apps/frontend

FROM node:20-bullseye-slim AS runtime

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/package.json

RUN npm ci --omit=dev --workspace=apps/frontend --include-workspace-root

COPY --from=build /app/apps/frontend/.next /app/apps/frontend/.next
COPY --from=build /app/apps/frontend/public /app/apps/frontend/public
COPY --from=build /app/apps/frontend/next.config.ts /app/apps/frontend/next.config.ts

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace=apps/frontend"]
