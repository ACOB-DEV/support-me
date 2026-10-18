import { Request, RequestHandler } from 'express';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../errors/AppError';
import { getJwtSecret } from '../config';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    // Null for a magic-link (#15) or OAuth (#14) account that hasn't
    // connected a wallet. Existing wallet-authenticated call sites that
    // compare this against a Stellar address (e.g. authorizing a
    // subscription action) still behave correctly when it's null: a
    // non-wallet user can never equal a real wallet address, so they're
    // correctly denied rather than needing every call site updated.
    walletAddress: string | null;
  };
}

// Typed as a plain `RequestHandler` (not `(req: AuthRequest, ...) => void`) so
// it can be passed straight to `router.use`/`router.get` etc. without an
// `as any` cast at every call site: a handler accepting the narrower
// `AuthRequest` isn't assignable where Express expects one accepting
// `Request`, even though this function only ever runs within this app's own
// Express instance. The cast narrows in exactly one place instead of 16.
export const authMiddleware: RequestHandler = (req, res, next) => {
  const authReq = req as AuthRequest;
  const token = authReq.headers.authorization?.split(' ')[1];

  if (!token) {
    return next(new UnauthorizedError('No token provided'));
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as {
      id: number;
      walletAddress: string | null;
    };
    authReq.user = decoded;
    next();
  } catch {
    return next(new UnauthorizedError('Invalid token'));
  }
};

export const generateToken = (userId: number, walletAddress: string | null): string => {
  return jwt.sign(
    { id: userId, walletAddress },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
};
