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
        <Skeleton className="h-10 w-44 mb-8" />

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

        {/* Users table */}
        <div className="card-brutal p-6">
          <div className="flex items-center justify-between gap-2 mb-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>

          <div className="space-y-3">
            {/* Table row headers */}
            <div className="hidden sm:flex items-center justify-between pb-3 border-b-2 border-ink/10 text-xs font-bold">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
            </div>

            {/* Table rows */}
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-ink/5 gap-2">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-28 font-mono" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <div className="flex items-center gap-4 sm:justify-end">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-24 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
