FROM mcr.microsoft.com/devcontainers/base:trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs gjs libglib2.0-bin \
    && rm -rf /var/lib/apt/lists/*
