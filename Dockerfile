FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --only=production
COPY server/ .
RUN npm run build
EXPOSE 3002
CMD ["npm", "start"]
