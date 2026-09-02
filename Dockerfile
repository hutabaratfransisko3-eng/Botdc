# 1. Gunakan Node.js LTS versi ringan (Alpine Linux)
FROM node:18-alpine

# 2. Tentukan direktori kerja di dalam kontainer
WORKDIR /usr/src/app

# 3. Salin berkas package.json dan package-lock.json terlebih dahulu
COPY package*.json ./

# 4. Install dependencies proyek
RUN npm install --production

# 5. Salin seluruh sisa berkas kode ke dalam kontainer
COPY . .

# 6. Jalankan bot saat kontainer dinyalakan
CMD ["npm", "start"]