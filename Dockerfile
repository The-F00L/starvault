# syntax=docker/dockerfile:1
FROM node:24.14.1-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:24.14.1-slim
WORKDIR /app
# Inside the container the server must listen on all interfaces to be reachable at all.
# docker-compose.yml publishes the port on the host's 127.0.0.1 only; expose it with `tailscale serve`.
ENV NODE_ENV=production HOST=0.0.0.0 ALLOW_PUBLIC_BIND=1 PORT=8787 DATA_DIR=/data DIST_DIR=/app/dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=1m --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/instance').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/selfhost.mjs"]
