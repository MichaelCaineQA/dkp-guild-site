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
  async rewrites() {
    return process.env.NODE_ENV === 'development'
      ? [{ source: '/api/:path*', destination: 'http://localhost:3001/:path*' }]
      : [];
  },
  // Монорепо: трассировка зависимостей ведётся от корня репозитория
  // (pnpm-структура node_modules), иначе standalone что-то потеряет
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;
