import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes - serve from cache, refetch in background
      gcTime: 10 * 60 * 1000, // 10 minutes - keep unused data longer
      retry: 2,
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
      retryDelay: 1000,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      console.error('Query error:', error);
      // Global query error handler - can be overridden per-query
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      console.error('Mutation error:', error);
      if (mutation.options.onError) {
        return;
      }
      toast.error('Failed to save changes. Please try again.');
    },
  }),
});
