# Koristi lakši Node.js Alpine image
FROM node:18-alpine

# Setiraj radni direktorij
WORKDIR /app

# Instaliraj potrebne dependencyje (Chromium za Puppeteer)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Postavi Puppeteer da koristi sistemski Chromium
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium-browser"

# Kopiraj package.json i package-lock.json
COPY package.json package-lock.json ./

# Instaliraj npm dependencyje
RUN npm install --omit=dev

# Kopiraj ostatak koda
COPY . .

# Pokreni aplikaciju
CMD ["npm", "start"]