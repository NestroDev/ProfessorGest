export async function driveFetch(
  url,
  { getAccessToken, invalidateToken, options = {}, retry = true } = {},
) {
  if (typeof getAccessToken !== 'function') {
    throw new Error('Provedor de token do Google Drive não configurado.');
  }

  const token = await getAccessToken({ forceConsent: false });
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && retry) {
    invalidateToken?.();
    return driveFetch(url, {
      getAccessToken,
      invalidateToken,
      options,
      retry: false,
    });
  }

  return response;
}

export async function driveJson(url, config = {}) {
  const response = await driveFetch(url, config);
  let data = null;

  try {
    data = await response.json();
  } catch (_) {
    // Non-JSON responses are handled by the generic status error below.
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Google Drive respondeu com ${response.status}.`,
    );
  }

  return data;
}

export async function driveText(url, config = {}) {
  const response = await driveFetch(url, config);
  const text = await response.text();

  if (!response.ok) {
    let message = `Google Drive respondeu com ${response.status}.`;
    let apiError = null;
    try {
      apiError = JSON.parse(text)?.error || null;
      message = apiError?.message || message;
    } catch (_) {
      // Keep the generic message when the response body is not JSON.
    }
    const error = new Error(message);
    error.status = response.status;
    error.code = apiError?.code || `HTTP_${response.status}`;
    throw error;
  }

  return text;
}
