# Menggunakan Node.js versi 18 yang ringan (Alpine)
FROM node:18-alpine

# Menentukan direktori kerja di dalam container
WORKDIR /usr/src/app

# Menyalin package.json dan menginstal library
COPY package*.json ./
RUN npm install

# Menyalin seluruh kode ke dalam container
COPY . .

# Menjalankan aplikasi
CMD [ "npm", "start" ]
