FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
COPY public ./public
ENV DB_FILE=/data/app.db PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["node", "src/server.js"]
