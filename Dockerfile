FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci
COPY server/ .
RUN npm run build
RUN npm prune --omit=dev
EXPOSE 3002
CMD ["npm", "start"]
