# 国内网络构建示例（基础镜像与 pip 都可换源）：
#   docker pull docker.m.daocloud.io/library/python:3.12-slim
#   docker tag docker.m.daocloud.io/library/python:3.12-slim python:3.12-slim
#   docker compose --env-file .env.docker build \
#     --build-arg PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple admin
#
# 前端（front/，Vite + React + Ant Design）在 builder 阶段构建，
# 产物 front/dist 拷入运行镜像，由 admin/server.py 的 /admin 与 /admin/assets 下发。

# ---------- 前端构建阶段 ----------
FROM node:22-alpine AS frontend
WORKDIR /build
COPY front/package.json front/package-lock.json ./
RUN npm ci
COPY front/ ./
RUN npm run build

# ---------- 运行镜像 ----------
ARG BASE_IMAGE=python:3.12-slim
FROM ${BASE_IMAGE}

WORKDIR /app

ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_EXTRA_ARGS=""

COPY requirements.txt .
RUN pip install --no-cache-dir -i ${PIP_INDEX_URL} ${PIP_EXTRA_ARGS} -r requirements.txt

COPY converter.py responses_adapter.py responses_projection.py anthropic_adapter.py desensitize.py upstream_compat.py repository_instructions.py model_metadata.py wb_install.py wb_asar.py wb_envcheck.py turing_helper.js ./
COPY admin ./admin
COPY --from=frontend /build/dist ./front/dist
COPY desktop/__init__.py desktop/common.py desktop/runtime.py desktop/updates.py desktop/version.json ./desktop/
COPY desktop/assets ./desktop/assets

EXPOSE 8790 8787

CMD ["python3", "-m", "uvicorn", "admin.server:app", "--host", "0.0.0.0", "--port", "8790"]
