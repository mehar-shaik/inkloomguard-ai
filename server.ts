import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import type http from 'node:http';
import { initDatabase, closeDatabase, DB_ENGINE } from './server/db.ts';
import { getStorageMode, getStorageStatus } from './server/storage.ts';
import { createApiRouter } from './server/routes.ts';

function isAllowedOrigin(origin: string): boolean {
  const configured = [process.env.APP_URL, process.env.RENDER_EXTERNAL_URL]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.trim().replace(/\/+$/, ''));
  if (configured.includes(origin.replace(/\/+$/, ''))) return true;

  const extraOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (extraOrigins.includes(origin.replace(/\/+$/, ''))) return true;

  try {
    const parsed = new URL(origin);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
    if (parsed.hostname.endsWith('.run.app')) return true;
    if (parsed.hostname.endsWith('.onrender.com')) return true;
    if (parsed.hostname === 'aistudio.google.com') return true;
  } catch {
    return false;
  }
  return false;
}

export async function createApp(): Promise<express.Express> {
  getStorageMode();
  await initDatabase();

  const app = express();
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use('/api', createApiRouter());
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  let closeVite: (() => Promise<void>) | null = null;
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    closeVite = async () => {
      await vite.close();
    };
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.locals.closeResources = async () => {
    if (closeVite) {
      await closeVite();
      closeVite = null;
    }
  };

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[InkloomGuard AI] Unhandled request error:', err instanceof Error ? err.message : 'Unknown error');
    if (req.path.startsWith('/api')) {
      res.status(500).json({ error: 'Internal server error.' });
      return;
    }
    res.status(500).send('Internal server error.');
  });

  return app;
}

async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT) || 3000;
  const storage = getStorageStatus();

  const server: http.Server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `InkloomGuard AI server listening on port ${PORT} (db=${DB_ENGINE}, storage=${storage.mode}${storage.bucket ? `:${storage.bucket}` : ''})`
    );
  });

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[InkloomGuard AI] Received ${signal}. Closing HTTP server and database pool...`);

    const forceTimer = setTimeout(() => {
      console.error('[InkloomGuard AI] Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    server.close(async () => {
      try {
        if (typeof app.locals.closeResources === 'function') {
          await app.locals.closeResources();
        }
        await closeDatabase();
      } catch (err) {
        console.error('[InkloomGuard AI] Error closing resources:', err);
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });
}

// Only bind HTTP port when executed as entrypoint
const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('server.ts') &&
  process.env.INKLOOM_SKIP_AUTOSTART !== 'true';

if (isDirectExecution) {
  startServer().catch((err) => {
    console.error('Failed to start InkloomGuard AI server:', err);
    process.exit(1);
  });
}
