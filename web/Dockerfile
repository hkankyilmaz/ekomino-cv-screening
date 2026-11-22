FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_NO_WARNINGS=1 \
    DATA_DIR=/app/data \
    INBOX_DIR=/app/inbox/incoming
EXPOSE 3000
CMD ["node", "server.js"]
