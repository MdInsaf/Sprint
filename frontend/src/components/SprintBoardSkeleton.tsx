import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function SprintBoardSkeleton() {
  const columns = 5; // Backlog + 4 status columns
  const cardsPerColumn = 4;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-48" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:gap-4">
        {Array.from({ length: columns }).map((_, colIndex) => (
          <div key={colIndex} className="space-y-3 xl:flex-1">
            <div className="flex items-center justify-between rounded-md px-2 py-1.5">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-5 w-8" />
            </div>
            <div className="min-h-[500px] space-y-2 rounded-lg bg-secondary/30 p-2">
              {Array.from({ length: cardsPerColumn }).map((_, cardIndex) => (
                <Card key={cardIndex}>
                  <CardContent className="p-3 space-y-3">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-3 w-3 rounded-full" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <Skeleton className="h-5 w-12" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
    </div>
  );
}
