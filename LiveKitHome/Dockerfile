FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN ./node_modules/.bin/pinggy --version
COPY *.mjs ./
CMD ["node", "server.mjs"]
