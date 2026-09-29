import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const startedAt = new Date().toISOString();

const json = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
  });
  res.end(body);
};

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Método não suportado.' } });
    return;
  }

  if (url.pathname === '/api/v1/health') {
    json(res, 200, {
      ok: true,
      service: 'professorgest-api',
      version: '1.0.0',
      startedAt,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === '/api/v1/version') {
    json(res, 200, {
      name: 'ProfessorGest API',
      version: '1.0.0',
      apiVersion: 'v1',
      mode: 'stateless',
      storage: 'client-owned .prof files',
    });
    return;
  }

  json(res, 404, { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } });
});

server.listen(PORT, HOST, () => {
  console.log(`ProfessorGest API disponível em http://${HOST}:${PORT}`);
});
