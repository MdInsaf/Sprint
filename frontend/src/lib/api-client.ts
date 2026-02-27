import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '/v1/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends RequestInit {
  skipErrorToast?: boolean;
  retryCount?: number;
  retryDelay?: number;
}

let csrfToken: string | null = null;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

async function ensureCsrfToken(): Promise<string> {
  const cookieToken = readCookie('csrftoken');
  if (csrfToken && cookieToken === csrfToken) return csrfToken;

  const response = await fetch(`${API_BASE}/csrf`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to obtain CSRF token');
  }
  csrfToken = readCookie('csrftoken');
  if (!csrfToken) {
    throw new Error('CSRF token missing');
  }
  return csrfToken;
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const {
    skipErrorToast = false,
    retryCount = 3,
    retryDelay = 1000,
    ...init
  } = options;

  const method = (init?.method || 'GET').toUpperCase();
  const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (needsCsrf) {
    const token = await ensureCsrfToken();
    headers['X-CSRFToken'] = token;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retryCount; attempt++) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        ...init,
        headers,
        ...(method === 'GET' ? { cache: 'no-store' } : {}),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new ApiError(
          message || `Request failed: ${response.status}`,
          response.status
        );
      }

      return response.status === 204
        ? (undefined as T)
        : ((await response.json()) as T);
    } catch (error) {
      lastError = error as Error;

      // Don't retry on client errors (4xx)
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        break;
      }

      // Retry with exponential backoff
      if (attempt < retryCount - 1) {
        await delay(retryDelay * Math.pow(2, attempt));
        continue;
      }
    }
  }

  // Show error toast unless explicitly skipped
  if (!skipErrorToast && lastError) {
    toast.error(lastError.message || 'An error occurred');
  }

  throw lastError;
}
