import { Skeleton } from '@/components/Skeleton';

export function ProfileSkeleton() {
  return (
    <div className="min-h-screen bg-background py-10 px-4" data-testid="profile-skeleton" aria-busy="true">
      <div className="max-w-md mx-auto space-y-6">
        {/* Creator header */}
        <div className="card-brutal p-8 text-center">
          <div className="w-24 h-24 mx-auto mb-4 rounded-full border-4 border-ink/20 overflow-hidden bg-accent-bg flex items-center justify-center">
            <Skeleton className="w-full h-full rounded-full" />
          </div>
          <Skeleton className="h-7 w-44 mx-auto mb-2" />
          <Skeleton className="h-4 w-24 mx-auto mb-4" />
          <div className="space-y-1.5 mb-4 max-w-xs mx-auto">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4 mx-auto" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-6">
            <Skeleton className="h-7 w-20 rounded" />
            <Skeleton className="h-7 w-20 rounded" />
          </div>

          {/* Goal progress placeholder */}
          <div className="mt-6 pt-6 border-t-2 border-ink/10 text-left space-y-2">
            <div className="flex justify-between items-center gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-3 w-full rounded-full" />
          </div>
        </div>

        {/* Donation card */}
        <div className="card-brutal p-6">
          <div className="flex items-center justify-between gap-2 mb-4">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-5 w-16 rounded" />
          </div>

          <div className="space-y-4">
            {/* Wallet / Balance banner */}
            <div className="card-brutal p-3">
              <Skeleton className="h-4 w-28 mb-1" />
              <Skeleton className="h-5 w-24" />
            </div>

            {/* Recurring toggle */}
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-10 w-full rounded" />
              <Skeleton className="h-10 w-full rounded" />
            </div>

            {/* Presets */}
            <div>
              <Skeleton className="h-4 w-28 mb-2" />
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded" />
                ))}
              </div>
            </div>

            {/* Custom amount */}
            <div>
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-12 w-full rounded" />
            </div>

            {/* Message input */}
            <div>
              <Skeleton className="h-4 w-32 mb-2" />
              <Skeleton className="h-20 w-full rounded" />
            </div>

            {/* Submit button */}
            <Skeleton className="h-12 w-full rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
