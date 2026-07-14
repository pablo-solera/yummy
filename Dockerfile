# syntax=docker/dockerfile:1

##
## 1) deps: instala TODAS las dependencias (incluidas devDependencies) para
##    poder compilar el proyecto TypeScript en la siguiente fase.
##
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

##
## 2) build: compila TypeScript -> JavaScript (dist/).
##
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build

##
## 3) prod-deps: instala solo las dependencias de producción, sin
##    devDependencies (typescript, tsx, @types/*), para que no acaben en la
##    imagen final.
##
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

##
## 4) runtime: imagen final mínima. Solo contiene el JS ya compilado, las
##    dependencias de producción y un usuario sin privilegios.
##
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# tini se usa como PID 1 para reenviar correctamente señales (SIGTERM/SIGINT)
# al proceso de Node y evitar procesos zombis, siguiendo buenas prácticas de
# contenedores para procesos de larga duración como este bot.
RUN apk add --no-cache tini

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# La imagen oficial de Node ya incluye un usuario "node" (uid 1000) sin
# privilegios; lo usamos en vez de ejecutar como root.
USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/bot/telegram.js"]
