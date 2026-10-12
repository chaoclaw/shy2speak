FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev

FROM --platform=$BUILDPLATFORM curlimages/curl:8.16.0 AS media-tools
ARG TARGETARCH
USER root
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export CURL_CA_BUNDLE=/run/secrets/npm_ca; fi; \
    case "$TARGETARCH" in \
      amd64) asset="yt-dlp_musllinux"; checksum="f3dec9cfeaf304cec98290fe41c6ad465d4b747d302473559643e7af24929722" ;; \
      arm64) asset="yt-dlp_musllinux_aarch64"; checksum="17b164c4d258be92bb1ad146cb7c336b783aedb380814aabbcb7d52937f77e57" ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl --fail --location --retry 3 --output /yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/$asset" \
    && echo "$checksum  /yt-dlp" | sha256sum -c - \
    && chmod 0555 /yt-dlp

FROM node:24-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=media-tools --chown=root:root /yt-dlp /usr/local/bin/yt-dlp
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node index.html boot.js i18n.js app.js backend.js styles.css runtime-config.js sw.js manifest.webmanifest ./
COPY --chown=node:node data ./data
COPY --chown=node:node icons ./icons
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server/index.js"]
