# Build san pham tinh roi phuc vu bang nginx - KHONG chay `vite dev` tren
# server. Vite dev cham, khong nen va giu ca toolchain trong image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# QUAN TRONG: Vite nhung bien VITE_* vao bundle LUC BUILD, khong doc luc
# chay. Doi dia chi server nghia la phai BUILD LAI image, khong the chi doi
# bien moi truong cua container roi restart.
ARG VITE_IDENTITY_API_URL
ARG VITE_WORKSPACE_API_URL
ARG VITE_CHAT_API_URL
ARG VITE_MEDIA_API_URL
ARG VITE_ADMIN_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
