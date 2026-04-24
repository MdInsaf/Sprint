export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export function isPaginatedResponse<T>(value: unknown): value is PaginatedResponse<T> {
  if (!value || typeof value !== 'object') return false;
  if (!('results' in value)) return false;
  const results = (value as { results?: unknown }).results;
  return Array.isArray(results);
}

export function extractResults<T>(value: PaginatedResponse<T> | T[]): T[] {
  return isPaginatedResponse<T>(value) ? value.results : value;
}

export function appendPaginationParams(path: string, page: number, pageSize: number): string {
  const [base, query] = path.split('?');
  const params = new URLSearchParams(query || '');
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  return `${base}?${params.toString()}`;
}

export function getNextPageParam<T>(
  page: PaginatedResponse<T>,
  _allPages: PaginatedResponse<T>[]
): number | undefined {
  if (!page.next) return undefined;
  try {
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const url = new URL(page.next, origin);
    const nextPage = url.searchParams.get('page');
    return nextPage ? Number(nextPage) : undefined;
  } catch {
    return undefined;
  }
}
