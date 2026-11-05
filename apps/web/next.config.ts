import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone-выход для Docker: server.js + трассированные зависимости.
  // Включается только в контейнере (ENV DOCKER_BUILD=1 в Dockerfile):
  // локальная сборка на Windows без прав на симлинки падает на трейсинге
  output: process.env.DOCKER_BUILD ? 'standalone' : undefined,
  transpilePackages: ['@dkp/shared'],
  // Монорепо: трассировка зависимостей ведётся от корня репозитория
  // (pnpm-структура node_modules), иначе standalone что-то потеряет
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;
