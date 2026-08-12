FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

# Cloud Run injects PORT at runtime; server.js already reads process.env.PORT.
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
