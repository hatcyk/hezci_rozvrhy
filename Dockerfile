# Lepší Rozvrh — production image
#
# Build:  docker build -t lepsi-rozvrh .
# Run:    see docker-compose.yml / DEPLOYMENT.md

FROM node:22-alpine

# Timezone matters: lesson reminders are computed for Europe/Prague.
RUN apk add --no-cache tzdata curl
ENV TZ=Europe/Prague
ENV NODE_ENV=production

WORKDIR /app

# Install dependencies first so this layer is cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Run as the unprivileged user that the base image already provides.
USER node

EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/api/status > /dev/null || exit 1

CMD ["node", "index.js"]
