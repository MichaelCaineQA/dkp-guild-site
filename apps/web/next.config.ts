import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone-выход для Docker: server.js + трассированные зависимости.
  // Включается только в контейнере (ENV DOCKER_BUILD=1 в Dockerfile):
  // локальная сборка на Windows без прав на симлинки падает на трейсинге
  output: process.env.DOCKER_BUILD ? 'standalone' : undefined,
  transpilePackages: ['@dkp/shared'],
  // В dev нет Caddy: сохраняем same-origin /api через прокси Next.
  // В production этот маршрут обслуживает Caddy напрямую, в том числе WebSocket.
  // DEV_API_ORIGIN — адрес API для прокси, когда он поднят не на :3001
  // (параллельные локальные стенды на своих портах).
  async rewrites() {
    const api = process.env.DEV_API_ORIGIN ?? 'http://localhost:3001';
    return process.env.NODE_ENV === 'development'
      ? [{ source: '/api/:path*', destination: `${api}/:path*` }]
      : [];
  },
  // Монорепо: трассировка зависимостей ведётся от корня репозитория
  // (pnpm-структура node_modules), иначе standalone что-то потеряет
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;
