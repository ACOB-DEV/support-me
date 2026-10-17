import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, HEAD } from '@/app/donate/route';

const request = (path: string) => new NextRequest(new URL(path, 'https://support.test'));

describe('/donate legacy redirect', () => {
  it('permanently redirects bare /donate to the landing page', () => {
    const res = GET(request('/donate'));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://support.test/');
  });

  it('sends /donate?to=<username> to that creator page', () => {
    const res = GET(request('/donate?to=alice_01'));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://support.test/alice_01');
  });

  it.each(['//evil.com', 'https://evil.com', '../admin', 'a', 'has space', ''])(
    'falls back to / for an invalid username %j',
    (to) => {
      const res = GET(request(`/donate?to=${encodeURIComponent(to)}`));
      expect(res.headers.get('location')).toBe('https://support.test/');
    },
  );

  it('handles HEAD the same way', () => {
    expect(HEAD(request('/donate?to=bob')).headers.get('location')).toBe('https://support.test/bob');
  });
});
