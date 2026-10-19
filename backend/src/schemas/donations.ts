import { z } from "zod";
import { assetCode, stellarAddress, txHash } from "./common";

export const listDonationsQuerySchema = z.object({
  creatorUsername: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createDonationSchema = z.object({
  creatorUsername: z.string().min(1, "creatorUsername is required"),
  senderAddress: stellarAddress,
  amount: z.coerce.number().positive("amount must be a positive number"),
  currency: assetCode.default("XLM"),
  message: z.string().max(500).optional(),
  // Required: a donation report must reference the on-chain transaction that
  // paid it, otherwise the row can never be corroborated by the event
  // listener. See issue #258 — hash-less reports used to be stored as
  // verified: true, which let anyone fabricate donations.
  transactionHash: txHash,
});
