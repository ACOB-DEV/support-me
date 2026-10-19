-- Reconciles the migration history with schema.prisma (#263).
--
-- Several models and columns were added to schema.prisma without a matching
-- migration (AdminAuditLog, EmailEvent/EmailEventType, Donation's event-sync
-- columns and their unique keys, User.deletedAt, Subscription.failureCount,
-- Creator's walletAddress index, MagicLinkToken's userId index), so
-- `prisma migrate deploy` on a fresh database produced a schema the Prisma
-- client did not recognize. This migration replays exactly
--
--   prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel prisma/schema.prisma
--
-- Every statement is guarded (IF NOT EXISTS / catalog checks) so the
-- migration is also a no-op on databases provisioned with `prisma db push`,
-- which already have all of these objects (e.g. production).

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EmailEventType') THEN
    CREATE TYPE "EmailEventType" AS ENUM ('SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED');
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "Donation" ADD COLUMN IF NOT EXISTS "eventIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Donation" ADD COLUMN IF NOT EXISTS "onChainEventId" TEXT;
ALTER TABLE "Donation" ADD COLUMN IF NOT EXISTS "operationIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Donation" ADD COLUMN IF NOT EXISTS "rpcEventId" TEXT;
ALTER TABLE "Donation" ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable (idempotent: dropping a default that is already gone is a no-op)
ALTER TABLE "NetworkCheckpoint" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "failureCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER,
    "adminWalletAddress" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailEvent" (
    "id" SERIAL NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "providerMessageId" TEXT,
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_id_idx" ON "AdminAuditLog"("createdAt", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailEvent_recipient_createdAt_idx" ON "EmailEvent"("recipient", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailEvent_providerMessageId_idx" ON "EmailEvent"("providerMessageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Creator_walletAddress_idx" ON "Creator"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Donation_onChainEventId_key" ON "Donation"("onChainEventId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Donation_rpcEventId_key" ON "Donation"("rpcEventId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Donation_transactionHash_operationIndex_eventIndex_key" ON "Donation"("transactionHash", "operationIndex", "eventIndex");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MagicLinkToken_userId_idx" ON "MagicLinkToken"("userId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AdminAuditLog_adminId_fkey'
  ) THEN
    ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey"
      FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
