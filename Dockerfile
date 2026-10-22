FROM node:22-slim

WORKDIR /app

# Runtime dependencies only: tsx runs the TypeScript server and esbuild bundles the browser code on request.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY tsconfig.json ./
COPY src/ src/
COPY public/ public/

ENV NODE_ENV=production PORT=3000
EXPOSE 3000

# API keys come from the container's environment (e.g. docker run --env-file .env), not from a baked-in .env.
USER node
CMD ["node", "--import", "tsx", "src/server.ts"]
