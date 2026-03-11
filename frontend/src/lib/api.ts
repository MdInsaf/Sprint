const DEFAULT_API_BASE = '/v1/api';

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  if (!raw) {
    return DEFAULT_API_BASE;
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

export async function apiGetJson<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    search.set(key, String(value));
  });

  const baseUrl = getApiBaseUrl();
  const query = search.toString();
  const url = `${baseUrl}${path}${query ? `?${query}` : ''}`;
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string')
      ? data.message
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}
