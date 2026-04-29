# frontend/Dockerfile
FROM node:20

# RUN apk add --no-cache libc6-compat openssl

WORKDIR /usr/src/app
COPY package*.json /
RUN npm install

COPY . .

# EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]