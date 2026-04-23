import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const defaultPort = Number(process.env.PORT ?? '4173');
const port = Number.isFinite(defaultPort) ? defaultPort : 4173;
const apiTarget = process.env.INTERNAL_API_TARGET ?? 'http://digital-life:3000';
const distDirectory = new URL('../dist/', import.meta.url).pathname;
const indexPath = join(distDirectory, 'index.html');

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const getContentType = (filePath: string): string =>
  contentTypes[extname(filePath)] ?? 'application/octet-stream';

const isSafeAssetPath = (filePath: string): boolean => filePath.startsWith(distDirectory);

const resolveAssetPath = (pathname: string): string => {
  if (pathname === '/' || pathname.length === 0) {
    return indexPath;
  }

  const sanitizedPath = normalize(pathname).replace(/^([/\\])+/, '');
  return join(distDirectory, sanitizedPath);
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const details = await stat(filePath);
    return details.isFile();
  } catch {
    return false;
  }
};

const checkApiHealth = async (): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(new URL('/health', apiTarget), {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const proxyRequest = async (request: Request, url: URL): Promise<Response> => {
  const upstreamUrl = new URL(`${url.pathname}${url.search}`, apiTarget);
  const headers = new Headers(request.headers);
  headers.set('host', upstreamUrl.host);

  return fetch(upstreamUrl, {
    headers,
    method: request.method,
    ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: request.body }),
  });
};

const serveAsset = async (pathname: string): Promise<Response> => {
  const assetPath = resolveAssetPath(pathname);
  if (!isSafeAssetPath(assetPath)) {
    return new Response('Not found', { status: 404 });
  }

  if (await fileExists(assetPath)) {
    return new Response(await readFile(assetPath), {
      headers: {
        'content-type': getContentType(assetPath),
      },
    });
  }

  if (extname(pathname).length > 0) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(await readFile(indexPath), {
    headers: {
      'content-type': getContentType(indexPath),
    },
  });
};

const app = new Hono();

app.get('/health', async (context) => {
  const apiHealthy = await checkApiHealth();
  return context.json({ ok: apiHealthy }, apiHealthy ? 200 : 503);
});

app.all('/api/*', async (context) => proxyRequest(context.req.raw, new URL(context.req.url)));

app.get('*', async (context) => serveAsset(new URL(context.req.url).pathname));

serve({
  fetch: app.fetch,
  port,
});

console.log(`digital-life web listening on http://localhost:${port}`);
