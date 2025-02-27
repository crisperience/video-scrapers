FROM mcr.microsoft.com/playwright:v1.50.1

# Install PostgreSQL client for debugging
RUN apt-get update && apt-get install -y postgresql-client

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

CMD ["node", "scrapers/eu_commission/index.js"]