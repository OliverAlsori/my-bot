FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm i --only=production
COPY tsconfig.json ./
COPY src ./src
RUN npm i -D typescript && npm run build && npm prune --production
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]


