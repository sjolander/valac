FROM node:20

WORKDIR /usr/src/app

COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
RUN npm install -g nodemon
RUN npm install

COPY . .

EXPOSE 3000
EXPOSE 9229

# Nodemon will use nodemon.json
CMD ["npx", "nodemon"]