FROM mcr.microsoft.com/playwright:v1.50.1

# Install PostgreSQL client and PM2 globally
RUN apt-get update && apt-get install -y postgresql-client && npm install -g pm2

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

# Ensure ecosystem.config.js is copied into /app
COPY ecosystem.config.js ./

CMD ["pm2-runtime", "start", "ecosystem.config.js"]