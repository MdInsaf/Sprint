type ErrorLike = {
  message?: string;
  detail?: string;
  reason?: string;
};

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as ErrorLike;
  return candidate.message || candidate.detail || candidate.reason || fallback;
}
