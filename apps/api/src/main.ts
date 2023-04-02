import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { graphql } from 'body-parser-graphql';
import { createClient, RedisClientType } from 'redis';
import { AddressInfo } from 'ws';

const RATE_LIMIT_BYTES_PER_MINUTES = 1_000_000;
const RATE_LIMIT_BYTES_PER_HOUR = 20_000_000;

const RATE_LIMIT_HITS_PER_MINUTES = 100;
const RATE_LIMIT_HITS_PER_HOUR = 3000;

async function addUsage(redis: RedisClientType, ip: string, usage: number) {
  const minBytesUsageKey = `gubal:${ip}:${new Date().getUTCMinutes()}B`;
  const hourBytesUsageKey = `gubal:${ip}:h${new Date().getUTCHours()}B`;
  const minHitUsageKey = `gubal:${ip}:${new Date().getUTCMinutes()}`;
  const hourHitUsageKey = `gubal:${ip}:h${new Date().getUTCHours()}`;
  await redis.set(minBytesUsageKey, 0, {
    NX: true,
    EX: 60
  });
  await redis.set(hourBytesUsageKey, 0, {
    NX: true,
    EX: 3600
  });
  await redis.set(minHitUsageKey, 0, {
    NX: true,
    EX: 60
  });
  await redis.set(hourHitUsageKey, 0, {
    NX: true,
    EX: 3600
  });
  await redis.incrBy(minBytesUsageKey, usage);
  await redis.incrBy(hourBytesUsageKey, usage);
  await redis.incr(minHitUsageKey);
  await redis.incr(hourHitUsageKey);
}

async function getUsage(redis: RedisClientType, ip: string) {
  const minUsageKey = `gubal:${ip}:${new Date().getUTCMinutes()}B`;
  const hourUsageKey = `gubal:${ip}:h${new Date().getUTCHours()}B`;
  const minHitUsageKey = `gubal:${ip}:${new Date().getUTCMinutes()}`;
  const hourHitUsageKey = `gubal:${ip}:h${new Date().getUTCHours()}`;
  return {
    minHit: await redis.get(minHitUsageKey),
    minBytes: await redis.get(minUsageKey),
    hourBytes: await redis.get(hourUsageKey),
    hourHit: await redis.get(hourHitUsageKey)
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3333;
  const redis = createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
  }) as unknown as RedisClientType;
  await redis.connect();
  app.enableCors();
  app.use(graphql());
  app.use(async (req, res, next) => {
    if (!req.url.endsWith('/gubal')) {
      next();
    } else {
      const { minBytes, hourBytes } = await getUsage(redis, req.ip);
      req.headers['X-Gubal-Usage'] = `${minBytes}|${hourBytes}`;
      next();
    }
  });
  const proxy = createProxyMiddleware({
    target: 'https://gubal.ffxivteamcraft.com/v1/graphql',
    pathRewrite: {
      '/gubal': ''
    },
    secure: true,
    changeOrigin: true,
    ws: true,
    onProxyReq: (proxyReq, req, res) => {
      if (req.method === 'OPTIONS') {
        return res.sendStatus(201);
      }
      if (req.method !== 'POST') {
        return res.sendStatus(405);
      }
      const [minUsage, hourUsage, minHit, hourHit] = req.headers['X-Gubal-Usage'].toString().split('|');
      delete req.headers['X-Gubal-Usage'];
      if (+minUsage > RATE_LIMIT_BYTES_PER_MINUTES
        || +minHit > RATE_LIMIT_HITS_PER_MINUTES
        || +hourUsage > RATE_LIMIT_BYTES_PER_HOUR
        || +hourHit > RATE_LIMIT_HITS_PER_HOUR
      ) {
        return res.sendStatus(429);
      }
      fixRequestBody(proxyReq, req);
    },
    onProxyReqWs: async (proxyReq, req, socket) => {
      socket.on('data', async d => {
        const addr: AddressInfo = socket.address() as AddressInfo;
        await addUsage(redis, addr.address, Buffer.byteLength(d));
        const { minBytes, hourBytes } = await getUsage(redis, addr.address);
        if (+minBytes > RATE_LIMIT_BYTES_PER_MINUTES || +hourBytes > RATE_LIMIT_BYTES_PER_HOUR) {
          socket.end();
        }
      });
    },
    onProxyRes: (proxyRes, req, res) => {
      const _write = res.write;
      res.write = (data, cb) => {
        const contentLength = Buffer.byteLength(data);
        addUsage(redis, req.ip, contentLength);
        return _write.call(res, data, cb);
      };
    },
    onError: err => console.error(err)
  });
  app.use(
    '/gubal',
    proxy
  );
  const server = await app.listen(port);
  server.on('upgrade', proxy.upgrade);
  Logger.log(`🚀 Application is running on: http://localhost:${port}, XIVAPI_KEY LOADED: ${environment.xivapiKey !== undefined}`);
}

bootstrap();
