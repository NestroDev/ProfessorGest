export async function driveFetch(url, { getAccessToken, invalidateToken, options = {}, retry = true } = {}) {
  if (typeof getAccessToken !== 'function') throw new Error('Provedor de token do Google Drive não configurado.');
  const token = await getAccessToken({ forceConsent: false });
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && retry) {
    invalidateToken?.();
    return driveFetch(url, { getAccessToken, invalidateToken, options, retry: false });
  }
  return response;
}

export async function driveJson(url, config = {}) {
  const response = await driveFetch(url, config);
  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(data?.error?.message || `Google Drive respondeu com ${response.status}.`);
  return data;
}

export async function driveText(url, config = {}) {
  const response = await driveFetch(url, config);
  const text = await response.text();
  if (!response.ok) {
    let message = `Google Drive respondeu com ${response.status}.`;
    try { message = JSON.parse(text)?.error?.message || message; } catch (_) {}
    throw new Error(message);
  }
  return text;
}
