FROM node:22-alpine

WORKDIR /app
COPY . .

ENV HOST=0.0.0.0
ENV PORT=8080
# Передайте TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET через docker run -e.
EXPOSE 8080

CMD ["node", "server.mjs"]
