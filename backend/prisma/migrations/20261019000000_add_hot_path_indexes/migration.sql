-- The migration chain predates the Donation event-sync columns: they were
-- added to schema.prisma in 2296026 without a migration. Two indexes below
-- reference `verified`, so a database built with `prisma migrate deploy`
-- needs the column before they can be created. `IF NOT EXISTS` makes this a
-- no-op on databases provisioned with `prisma db push`, which already have
-- the column.
ALTER TABLE "Donation" ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Donation_creatorId_verified_createdAt_idx" ON "Donation"("creatorId", "verified", "createdAt");

-- CreateIndex
CREATE INDEX "Donation_senderAddress_idx" ON "Donation"("senderAddress");

-- CreateIndex
CREATE INDEX "Donation_currency_verified_idx" ON "Donation"("currency", "verified");

-- CreateIndex
CREATE INDEX "Withdrawal_creatorId_createdAt_idx" ON "Withdrawal"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "Subscription_active_nextChargeAt_idx" ON "Subscription"("active", "nextChargeAt");

-- CreateIndex
CREATE INDEX "Subscription_supporterAddress_idx" ON "Subscription"("supporterAddress");

-- CreateIndex
CREATE INDEX "Subscription_creatorId_idx" ON "Subscription"("creatorId");

