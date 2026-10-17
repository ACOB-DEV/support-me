import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileSkeleton } from '@/components/ProfileSkeleton';

describe('ProfileSkeleton', () => {
  it('renders both creator header and donation form skeleton cards', () => {
    const { container } = render(<ProfileSkeleton />);
    expect(screen.getByTestId('profile-skeleton')).toBeInTheDocument();

    // Two brutal cards: creator header card and support donation card
    const cards = container.querySelectorAll('.card-brutal');
    expect(cards.length).toBeGreaterThanOrEqual(2);

    // Form inputs and preset buttons exist in the skeleton
    const presetsGrid = container.querySelector('.grid.grid-cols-4');
    expect(presetsGrid).toBeInTheDocument();

    const tabsGrid = container.querySelector('.grid.grid-cols-2');
    expect(tabsGrid).toBeInTheDocument();

    // Contains pulsing elements
    const pulsingElements = container.querySelectorAll('.motion-safe\\:animate-pulse');
    expect(pulsingElements.length).toBeGreaterThan(10);
  });
});
