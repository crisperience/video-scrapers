# Use the latest Playwright Docker image
FROM mcr.microsoft.com/playwright:v1.50.1

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy all project files
COPY . .

# Start the application
CMD ["npm", "start"]