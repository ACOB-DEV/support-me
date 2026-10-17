import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from '@/components/Skeleton';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';
import { ActivitySkeleton } from '@/components/ActivitySkeleton';
import { ProfileSkeleton } from '@/components/ProfileSkeleton';
import { DonationHistorySkeleton } from '@/components/DonationHistorySkeleton';

describe('Skeleton', () => {
  it('pulses only when the user allows motion', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toBeInTheDocument();
    const classes = el.className.split(/\s+/);
    expect(classes).toContain('motion-safe:animate-pulse');
    // No unconditional animation that would ignore prefers-reduced-motion.
    expect(classes).not.toContain('animate-pulse');
  });

  it('stays visibly a placeholder (dimmed) under reduced motion', () => {
    const { container } = render(<Skeleton />);
    expect((container.firstChild as HTMLElement).className).toContain('motion-reduce:opacity-60');
  });

  it('merges the provided className', () => {
    const { container } = render(<Skeleton className="h-4 w-10" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('h-4');
    expect(el.className).toContain('w-10');
  });

  it.each([
    ['DashboardSkeleton', <DashboardSkeleton key="d" showNav={false} />, 'dashboard-skeleton'],
    ['ActivitySkeleton', <ActivitySkeleton key="a" showNav={false} />, 'activity-skeleton'],
    ['ProfileSkeleton', <ProfileSkeleton key="p" />, 'profile-skeleton'],
    ['DonationHistorySkeleton', <DonationHistorySkeleton key="h" />, 'donation-history-skeleton'],
  ])('%s marks its region aria-busy and never animates unconditionally', (_name, element, testId) => {
    const { getByTestId, container } = render(element);
    expect(getByTestId(testId)).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('.animate-pulse, .animate-spin')).toHaveLength(0);
  });
});
