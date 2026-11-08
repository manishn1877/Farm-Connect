FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=8787 DB_PATH=/var/data/farmconnect.db TRUST_PROXY=1
EXPOSE 8787
CMD ["sh","-c","node --no-warnings seed.js && node --no-warnings server.js"]
