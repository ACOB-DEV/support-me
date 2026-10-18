import { RequestHandler } from 'express';
import { AuthRequest } from './auth';
import { ForbiddenError } from '../errors/AppError';

// Gates admin-only routes to a wallet allowlist. Runs AFTER authMiddleware, so
// req.user is already populated from a verified JWT — here we only check that
// the authenticated wallet is one we trust.
//
// Configured via ADMIN_WALLETS (comma-separated Stellar addresses). Fail-closed:
// if the env var is missing or empty, nobody is admin, and we log a warning so a
// misconfigured deploy can't silently expose everyone's data.
const parseAdminWallets = (): string[] =>
  (process.env.ADMIN_WALLETS || '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

// Typed as a plain `RequestHandler`, same reasoning as `authMiddleware` in
// `./auth`: it needs `AuthRequest`'s `.user`, which `authMiddleware` (running
// first in the chain) has already attached, but a handler typed to accept
// only `AuthRequest` isn't assignable where Express expects one accepting
// `Request`.
export const adminAuth: RequestHandler = (req, res, next) => {
  const authReq = req as AuthRequest;
  const admins = parseAdminWallets();

  if (admins.length === 0) {
    console.warn('ADMIN_WALLETS is not set — denying all admin access (fail-closed).');
    return next(new ForbiddenError('Admin access required'));
  }

  if (!authReq.user || !authReq.user.walletAddress || !admins.includes(authReq.user.walletAddress)) {
    return next(new ForbiddenError('Admin access required'));
  }

  next();
};
