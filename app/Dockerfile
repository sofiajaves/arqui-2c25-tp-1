FROM node:22

# Create app directory
WORKDIR /opt/app

# Copy only package files first for better layer caching
COPY package*.json ./
RUN npm install --only=production

# Copy the rest of the source (includes src/, state/, *.js, etc.)
COPY . .

EXPOSE 3000

ENTRYPOINT [ "node", "app.js" ]
