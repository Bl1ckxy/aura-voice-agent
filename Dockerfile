FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Frontend: Next.js static export -> /app/out (served by express)
RUN npm run build

# Backend: TypeScript -> /app/server/dist, prod dependencies only
RUN cd server && npm ci && npm run build && npm prune --omit=dev

EXPOSE 3002
CMD ["node", "server/dist/index.js"]
