# Use Node.js LTS
FROM node:20-slim

# Install required dependencies
RUN apt-get update && apt-get install -y \
    gnupg \
    curl \
    && curl -fsSL https://pgp.mongodb.com/server-6.0.asc | \
       gpg -o /usr/share/keyrings/mongodb-server-6.0.gpg --dearmor \
    && echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg ] https://repo.mongodb.org/apt/debian bullseye/mongodb-org/6.0 main" | tee /etc/apt/sources.list.d/mongodb-org-6.0.list \
    && apt-get update \
    && apt-get install -y mongodb-database-tools \
    && curl -fsSL https://downloads.mongodb.com/compass/mongodb-mongosh_1.10.1_amd64.deb -o mongosh.deb \
    && dpkg -i mongosh.deb || true \
    && apt-get install -f -y \
    && rm mongosh.deb \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create backup directory
RUN mkdir -p /backups

# Set environment variables
ENV NODE_ENV=production

# Run the application
CMD ["npm", "start"] 