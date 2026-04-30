const API_BASE_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');

export function apiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export async function readJsonResponse(response, fallbackMessage = 'Request failed') {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || fallbackMessage);
    return body;
  }

  const text = await response.text();
  const hint = text.trim().slice(0, 80);
  const message = response.ok
    ? 'Server returned HTML instead of JSON. Check VITE_SERVER_URL or the /api proxy.'
    : `Request failed with ${response.status}. Check VITE_SERVER_URL or the /api proxy.`;

  throw new Error(hint ? `${message} Response started with: ${hint}` : message);
}
