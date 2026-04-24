const DEFAULT_API_BASE = '/v1/api';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

let csrfPromise: Promise<void> | null = null;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const parts = document.cookie.split(';');
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join('='));
    }
  }

  return null;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    search.set(key, String(value));
  });

  const baseUrl = getApiBaseUrl();
  const query = search.toString();
  return `${baseUrl}${path}${query ? `?${query}` : ''}`;
}

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  if (!raw) {
    return DEFAULT_API_BASE;
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

export async function ensureCsrfCookie(force = false): Promise<void> {
  if (!force && readCookie('csrftoken')) {
    return;
  }

  if (!force && csrfPromise) {
    return csrfPromise;
  }

  const request = (async () => {
    const response = await fetch(buildUrl('/csrf'), {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to initialize CSRF protection (${response.status})`);
    }
  })();

  csrfPromise = request;

  try {
    await request;
  } catch (error) {
    if (csrfPromise === request) {
      csrfPromise = null;
    }
    throw error;
  }

  if (csrfPromise === request) {
    csrfPromise = null;
  }
}

type ApiBody = BodyInit | FormData | Record<string, unknown> | null | undefined;

type ApiRequestOptions = {
  method?: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: ApiBody;
  headers?: HeadersInit;
  skipCsrf?: boolean;
};

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();

  if (!SAFE_METHODS.has(method) && !options.skipCsrf) {
    await ensureCsrfCookie();
  }

  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const isJsonBody =
    options.body != null &&
    !isFormData &&
    typeof options.body !== 'string' &&
    !(options.body instanceof Blob) &&
    !(options.body instanceof URLSearchParams);

  let body: BodyInit | undefined;
  if (options.body != null) {
    body = isJsonBody ? JSON.stringify(options.body) : (options.body as BodyInit);
  }

  if (isJsonBody) {
    headers.set('Content-Type', 'application/json');
  }

  if (!SAFE_METHODS.has(method)) {
    const csrfToken = readCookie('csrftoken');
    if (csrfToken) {
      headers.set('X-CSRFToken', csrfToken);
    }
  }

  const response = await fetch(buildUrl(path, options.params), {
    method,
    credentials: 'include',
    headers,
    body,
  });

  if (response.status === 204) {
    return null as T;
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  let payload: unknown = null;
  let textPayload = '';

  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  } else {
    textPayload = await response.text().catch(() => '');
  }

  if (!response.ok) {
    const jsonPayload = payload as { message?: unknown; detail?: unknown; reason?: unknown } | null;
    const message =
      (typeof jsonPayload?.message === 'string' && jsonPayload.message) ||
      (typeof jsonPayload?.detail === 'string' && jsonPayload.detail) ||
      (typeof jsonPayload?.reason === 'string' && jsonPayload.reason) ||
      textPayload ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (contentType.includes('application/json')) {
    return payload as T;
  }

  return textPayload as T;
}

export function apiGetJson<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  return apiRequest<T>(path, { method: 'GET', params });
}

export function apiPostJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return apiRequest<T>(path, { method: 'POST', body });
}

export function apiPutJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return apiRequest<T>(path, { method: 'PUT', body });
}

export function apiDeleteJson<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'DELETE' });
}

export function apiPostFormData<T>(path: string, body: FormData): Promise<T> {
  return apiRequest<T>(path, { method: 'POST', body });
}

export function apiPutFormData<T>(path: string, body: FormData): Promise<T> {
  return apiRequest<T>(path, { method: 'PUT', body });
}
