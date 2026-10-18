import { AppNav } from '@/components/AppNav';
import { Skeleton } from '@/components/Skeleton';

export interface ActivitySkeletonProps {
  showNav?: boolean;
}

export function ActivitySkeleton({ showNav = true }: ActivitySkeletonProps) {
  return (
    <div className="min-h-screen bg-background" data-testid="activity-skeleton" aria-busy="true">
      {showNav && <AppNav />}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <Skeleton className="h-10 w-72 mb-3" />
        <Skeleton className="h-4 w-full max-w-2xl mb-2" />
        <Skeleton className="h-4 w-2/3 max-w-xl mb-8" />

        {/* Headline stats */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="card-brutal p-6">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-10 w-28" />
          </div>
          <div className="card-brutal p-6">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-10 w-28" />
          </div>
          <div className="card-brutal p-6">
            <Skeleton className="h-4 w-40 mb-3" />
            <Skeleton className="h-10 w-36" />
          </div>
        </div>
      </div>
    </div>
  );
}
