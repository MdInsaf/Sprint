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

  if (response.status === 204) {
    return null as T;
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    throw new Error('API returned a non-JSON response. Check VITE_API_URL or the Vite API proxy.');
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string')
      ? data.message
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (data == null) {
    throw new Error('API returned an empty JSON response.');
  }

  return data as T;
}
