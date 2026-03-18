FROM node:18

WORKDIR /app
ENV DATA_DIR=/data
COPY package*.json ./
RUN npm install
COPY . .
VOLUME ["/data"]

CMD ["npm", "start"]
