FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
RUN npm run build
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "server/index.js"]
