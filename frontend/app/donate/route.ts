import { NextRequest, NextResponse } from 'next/server';

// Mirrors the backend username rule (backend/src/schemas/creators.ts) so a
// crafted ?to= value (e.g. "//evil.com") can never become an open redirect.
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,30}$/;

/**
 * /donate is a legacy URL. Old links are permanently redirected server-side:
 * /donate?to=<username> goes to that creator's page, everything else to the
 * landing page. A 308 replaces the history entry, so Back doesn't loop.
 */
function redirectTarget(request: NextRequest): URL {
  const to = request.nextUrl.searchParams.get('to')?.trim();
  const pathname = to && USERNAME_PATTERN.test(to) ? `/${to}` : '/';
  return new URL(pathname, request.nextUrl.origin);
}

export function GET(request: NextRequest) {
  return NextResponse.redirect(redirectTarget(request), 308);
}

export const HEAD = GET;
