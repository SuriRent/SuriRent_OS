FROM node:22-alpine AS frontend-build

WORKDIR /src/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
ARG REACT_APP_BACKEND_URL=
ARG REACT_APP_MARKETING_HOST=
ARG REACT_APP_APP_URL=
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}
ENV REACT_APP_MARKETING_HOST=${REACT_APP_MARKETING_HOST}
ENV REACT_APP_APP_URL=${REACT_APP_APP_URL}
RUN npm run build

FROM python:3.11-slim AS app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libcairo2 \
        libgdk-pixbuf-2.0-0 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libzbar0 \
        poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir \
    --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/ \
    -r requirements.txt
COPY backend/ ./

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

FROM nginx:stable-alpine AS web

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /src/frontend/build /usr/share/nginx/html

EXPOSE 80
