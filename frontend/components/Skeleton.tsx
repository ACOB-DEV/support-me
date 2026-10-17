import { HTMLAttributes } from 'react';

// Pulses only when the OS allows motion (WCAG 2.3.3). With reduced motion the
// block stays still but dimmed, so it still reads as a placeholder; the
// skeleton wrappers mark the region aria-busy for assistive tech.
export function Skeleton({ className = '', style, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`motion-safe:animate-pulse motion-reduce:opacity-60 rounded-md border-2 border-ink/10 bg-ink/10 ${className}`}
      style={style}
      {...rest}
    />
  );
}
