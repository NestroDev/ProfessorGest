const DEFAULT_TIMEOUT_MS = 8000;

function resolveApiBase() {
  const configured = globalThis.PROFESSORGEST_API_BASE_URL || '';
  return String(configured).trim().replace(/\/$/, '');
}

export function createApiClient(baseUrl = resolveApiBase()) {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/$/, '');
  return {
    get baseUrl() { return normalizedBase; },
    get enabled() { return !!normalizedBase; },
    health() { return requestFrom(normalizedBase, '/api/v1/health'); },
    version() { return requestFrom(normalizedBase, '/api/v1/version'); },
    request(path, options = {}) { return requestFrom(normalizedBase, path, options); },
  };
}

async function requestFrom(base, path, options = {}) {
  if (!base) return null;
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...requestOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      ...requestOptions,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(payload?.error?.message || 'A API não concluiu a solicitação.');
      error.code = payload?.error?.code || `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export const apiClient = createApiClient();
