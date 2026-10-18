-- CreateTable
CREATE TABLE "NetworkCheckpoint" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkCheckpoint_pkey" PRIMARY KEY ("key")
);
