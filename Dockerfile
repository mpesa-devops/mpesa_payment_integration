FROM node:lts-alpine
# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY ["package.json", "package-lock.json*", "./"]

# Copy all source code before build so tsc can find .ts files
COPY . .


# Install ALL dependencies (including devDependencies) for build
RUN npm install --silent --no-audit

# Install TypeScript globally as a workaround for tsc not found
RUN npm install -g typescript --no-audit

# Build the TypeScript code
RUN npm run build
# Copy the Firebase service account file into the dist/src directory

COPY homework-gai-firebase-adminsdk-jifl9-188caca7e1.json dist/

# Remove dev dependencies after build (for smaller image)
RUN npm prune --production

# Set the environment variable for production (after build)
ENV NODE_ENV=production

# Expose the port that the notification service will run on
EXPOSE 3000

# Change ownership of the working directory to the node user
RUN chown -R node /usr/src/app

# Switch to the node user
USER node

# Start the app
CMD ["node", "dist/src/app.js"]