# ---------- 基础镜像 ----------
FROM --platform=linux/amd64 node:24-bullseye

# ---------- 镜像元数据 ----------
LABEL maintainer="autumns li"
LABEL description="Dockerfile with Node.js, pnpm, node-gyp, and Electron build dependencies"

# ---------- 工作目录 ----------
WORKDIR /workspace

# ---------- 系统依赖 ----------
RUN sed -i 's@deb.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list \
   && apt-get update \
   && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
   build-essential \
   curl \
   libudev-dev \
   libusb-1.0-0-dev \
   locales \
   pkg-config \
   python3 \
   rpm \
   && sed -i 's/^# *\(en_US.UTF-8 UTF-8\)/\1/' /etc/locale.gen \
   && locale-gen \
   && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8 \
   LC_ALL=en_US.UTF-8

# ---------- Node 工具 ----------
# 安装包管理、原生模块编译和 Electron 重编译工具
RUN npm install --global --no-audit --no-fund \
   pnpm \
   node-gyp \
   @mapbox/node-pre-gyp \
   @electron/rebuild \
   editorconfig-checker \
   && npm cache clean --force

# ---------- 环境变量 ----------
# 使用国内镜像下载 Electron 和 electron-builder 辅助二进制
ENV ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
ENV ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

# 使用国内镜像下载 node-gyp 所需的 Node.js headers
ENV NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node/

# ---------- 默认命令 ----------
CMD [ "bash" ]
