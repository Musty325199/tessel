# Builds the Tessel API (server/ plus the shared/ templates it imports).
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY shared ./shared
COPY server ./server
WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/index.ts"]
