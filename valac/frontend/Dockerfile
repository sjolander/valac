# frontend/Dockerfile
FROM node:20

# RUN apk add --no-cache libc6-compat openssl

WORKDIR /app
COPY . .
RUN npm install && npm run build

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]