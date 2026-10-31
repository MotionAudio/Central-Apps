# Motion Audio server: Node + ffmpeg (ffmpeg grades uploaded audio)
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY review ./review
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/index.js"]
