import { randomBytes, createHash } from "crypto";
import prisma from "../prisma";
import { sendEmail } from "./email/mailer";
import { magicLinkEmail } from "./email/templates";
import { generateToken } from "../middleware/auth";
import { BadRequestError, UnauthorizedError } from "../errors/AppError";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_BYTES = 32;

const verifyUrl = (token: string): string =>
  `${(process.env.APP_URL || "https://localhost:3000").replace(/\/$/, "")}/auth/magic-link/verify?token=${token}`;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a magic link, stores only its hash, and emails it. Silently
 * succeeds (does not throw, does not reveal whether the address is new)
 * so that requesting a link can never be used to enumerate which emails
 * have a SupportMe account. Callers should always return the same
 * generic "check your email" response regardless of this function's
 * internal path.
 */
export async function requestMagicLink(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Look up (but don't create) the account: a MagicLinkToken can be
  // requested for an email with no account yet, since verifying it is
  // what creates the account (see verifyMagicLink).
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  await prisma.magicLinkToken.create({
    data: { tokenHash, email: normalizedEmail, userId: user?.id, expiresAt },
  });

  await sendEmail({
    to: normalizedEmail,
    ...magicLinkEmail({ verifyUrl: verifyUrl(token), expiresInMinutes: TOKEN_TTL_MS / 60_000 }),
  });
}

export interface MagicLinkSession {
  user: { id: number; email: string; walletAddress: string | null };
  token: string;
  hasProfile: boolean;
  username?: string;
}

/**
 * Verifies a magic-link token and issues a session. New-account creation
 * and returning-account matching are both handled here (create-or-attach,
 * per the issue's acceptance criteria) since a token can be requested
 * before an account exists.
 *
 * Only the token's SHA-256 hash is ever stored or looked up (never the
 * raw token), so a database read alone can't be used to sign in.
 */
export async function verifyMagicLink(rawToken: string): Promise<MagicLinkSession> {
  if (!rawToken) {
    throw new BadRequestError("token is required");
  }

  const tokenHash = hashToken(rawToken);
  const record = await prisma.magicLinkToken.findUnique({ where: { tokenHash } });

  if (!record) {
    throw new UnauthorizedError("Invalid or expired magic link");
  }
  if (record.usedAt) {
    throw new UnauthorizedError("This magic link has already been used");
  }
  if (record.expiresAt < new Date()) {
    throw new UnauthorizedError("This magic link has expired");
  }

  // Mark used and create-or-attach the account in one transaction, so a
  // concurrent double-submit of the same link (e.g. an email client
  // prefetching the URL) can't both succeed and issue two sessions for
  // what should be a single-use token.
  //
  // This must be a single conditional WRITE, not a read-then-write: under
  // Postgres' default READ COMMITTED isolation, two concurrent
  // transactions can both read `usedAt = null` via findUnique() before
  // either commits its update, so a plain "check then update" (as this
  // used to do) does not actually prevent the race its own comment
  // claimed to. `updateMany` with `usedAt: null` in the WHERE clause
  // consumes the token atomically: Postgres' row-level locking ensures at
  // most one of two concurrent UPDATE statements matching the same row
  // reports count > 0, so only one of two racing requests can ever reach
  // the user upsert below.
  const user = await prisma.$transaction(async (tx) => {
    const consumed = await tx.magicLinkToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new UnauthorizedError("This magic link has already been used");
    }

    const account = await tx.user.upsert({
      where: { email: record.email },
      update: {},
      create: { email: record.email },
    });

    await tx.magicLinkToken.update({
      where: { tokenHash },
      data: { userId: account.id },
    });

    return account;
  });

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } });
  const token = generateToken(user.id, user.walletAddress);

  return {
    user: { id: user.id, email: user.email!, walletAddress: user.walletAddress },
    token,
    hasProfile: !!creator,
    username: creator?.username,
  };
}
