import { AppNav } from '@/components/AppNav';
import { Skeleton } from '@/components/Skeleton';
import { DonationHistorySkeleton } from '@/components/DonationHistorySkeleton';

export interface DashboardSkeletonProps {
  showNav?: boolean;
}

export function DashboardSkeleton({ showNav = true }: DashboardSkeletonProps) {
  return (
    <div className="min-h-screen bg-background" data-testid="dashboard-skeleton" aria-busy="true">
      {showNav && <AppNav />}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Header: Title and Share button */}
        <div className="flex items-center justify-between mb-8 gap-4">
          <Skeleton className="h-10 w-44" />
          <Skeleton className="h-11 w-24 rounded-lg" />
        </div>

        {/* Volume by asset, plus lifetime cashed out (3 columns) */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {/* XLM Volume */}
          <div className="card-brutal p-6">
            <Skeleton className="h-4 w-28 mb-3" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-4 w-20 mt-2" />
          </div>

          {/* USDC Volume */}
          <div className="card-brutal p-6">
            <Skeleton className="h-4 w-28 mb-3" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-4 w-20 mt-2" />
          </div>

          {/* Withdrawn */}
          <div className="card-brutal p-6">
            <Skeleton className="h-4 w-28 mb-3" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>

        {/* Earnings over time chart */}
        <div className="card-brutal p-6 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <Skeleton className="h-6 w-36 mb-1" />
              <Skeleton className="h-4 w-44" />
            </div>
            <Skeleton className="h-10 w-28 rounded-lg" />
          </div>

          <div className="flex items-end gap-1.5 h-40">
            {[40, 65, 30, 85, 45, 95, 25, 70, 55, 80, 50, 35].map((heightPct, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full">
                <Skeleton
                  className="w-full rounded-t-md"
                  style={{ height: `${heightPct}%` }}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-between mt-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>

        {/* Recent Activity — tips received and cash-outs */}
        <div className="card-brutal p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
          <DonationHistorySkeleton rows={5} />
        </div>
      </div>
    </div>
  );
}
