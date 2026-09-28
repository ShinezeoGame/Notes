# Étape 1 : construction du client web
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY client client
COPY server server
RUN npm run build

# Étape 2 : image d'exécution (serveur Node + client construit)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 HOST=0.0.0.0
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev && npm cache clean --force
COPY server server
COPY --from=build /app/client/dist client/dist
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server/src/index.js"]
