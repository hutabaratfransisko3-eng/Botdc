FROM node:20-alpine

# Tambahkan baris ini untuk menginstal Git di dalam container
RUN apk add --no-cache git

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --production

COPY . .

CMD ["npm", "start"]
