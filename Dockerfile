FROM node:16-alpine
LABEL org.opencontainers.image.source="https://github.com/pkoeppen/starchan-socket"

WORKDIR /app

COPY package.json /app/
RUN npm install --silent

COPY tsconfig.json /app/
COPY src/ /app/src/
RUN npm run build;

ARG NODE_ENV
ENV NODE_ENV ${NODE_ENV}
EXPOSE 3002

CMD [ "npm", "start" ]
