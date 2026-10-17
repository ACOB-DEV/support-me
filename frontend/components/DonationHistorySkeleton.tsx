import { Skeleton } from '@/components/Skeleton';

export interface DonationHistorySkeletonProps {
  rows?: number;
  className?: string;
}

export function DonationHistorySkeleton({
  rows = 4,
  className = '',
}: DonationHistorySkeletonProps) {
  return (
    <ul
      className={`divide-y divide-ink/10 ${className}`}
      data-testid="donation-history-skeleton"
      aria-busy="true"
      aria-label="Loading donation history"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="py-2.5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-20 rounded" />
            <Skeleton className="h-4 w-12 rounded hidden sm:inline-block" />
            <Skeleton className="h-4 w-24 rounded font-mono" />
            <Skeleton className="h-4 w-36 rounded flex-1 min-w-0" />
            <Skeleton className="h-4 w-14 rounded ml-auto pl-2" />
          </div>
        </li>
      ))}
    </ul>
  );
}
