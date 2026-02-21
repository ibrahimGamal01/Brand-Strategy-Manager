FROM node:20-bullseye-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json

RUN npm ci --workspace=apps/backend --include-workspace-root

COPY apps/backend apps/backend

RUN npx prisma generate --schema apps/backend/prisma/schema.prisma \
  && npm run build --workspace=apps/backend \
  && pip3 install --no-cache-dir -r apps/backend/scripts/requirements.txt

FROM node:20-bullseye-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/backend/package.json /app/apps/backend/package.json
COPY --from=build /app/apps/backend/dist /app/apps/backend/dist
COPY --from=build /app/apps/backend/prisma /app/apps/backend/prisma
COPY --from=build /app/apps/backend/scripts /app/apps/backend/scripts

RUN pip3 install --no-cache-dir -r /app/apps/backend/scripts/requirements.txt

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "apps/backend/dist/index.js"]
