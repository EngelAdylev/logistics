FROM node:20-alpine

ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Открываем порт для Vite
EXPOSE 3000

# Запускаем в режиме разработки с пробросом портов
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "3000"]