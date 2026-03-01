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

/**
 * React Query getNextPageParam compatible with both:
 * - Django REST paginated responses (next is a full URL with ?page=N)
 * - Supabase paginated responses (next is 'has-more' sentinel)
 */
export function getNextPageParam<T>(
  page: PaginatedResponse<T>,
  allPages: PaginatedResponse<T>[]
): number | undefined {
  if (!page.next) return undefined;
  // Supabase sentinel — use total pages loaded as next page number
  if (page.next === 'has-more') return allPages.length + 1;
  // Django URL-based pagination
  try {
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const url = new URL(page.next, origin);
    const nextPage = url.searchParams.get('page');
    return nextPage ? Number(nextPage) : undefined;
  } catch {
    return undefined;
  }
}

/** Build a PaginatedResponse from Supabase range query results. */
export function toPagedResponse<T>(
  data: T[] | null,
  count: number | null,
  page: number,
  pageSize: number
): PaginatedResponse<T> {
  const total = count ?? 0;
  const offset = (page - 1) * pageSize;
  return {
    count: total,
    next: offset + pageSize < total ? 'has-more' : null,
    previous: page > 1 ? 'has-previous' : null,
    results: data ?? [],
  };
}
