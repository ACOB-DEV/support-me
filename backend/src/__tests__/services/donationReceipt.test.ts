import { Donation, Prisma } from "@prisma/client";
import { notifyDonationReceived } from "../../services/donationNotifications";
import prisma from "../../prisma";
import { emailService } from "../../services/email/emailService";

// Fills in the `Donation` fields these tests don't care about, so each test
// only has to spell out the fields its assertions actually depend on instead
// of repeating the full Prisma row shape (and casting it away) three times.
function fakeDonation(overrides: Partial<Donation> & Pick<Donation, "id" | "creatorId">): Donation {
  return {
    senderAddress: "GTEST",
    amount: new Prisma.Decimal(0),
    currency: "XLM",
    message: null,
    transactionHash: null,
    onChainEventId: null,
    rpcEventId: null,
    operationIndex: 0,
    eventIndex: 0,
    verified: true,
    createdAt: new Date("2026-04-01T12:00:00Z"),
    ...overrides,
  };
}

jest.mock("../../prisma", () => ({
  __esModule: true,
  default: {
    creator: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

describe("notifyDonationReceived", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends receipt email when creator has an email address", async () => {
    const mockSendReceipt = jest
      .spyOn(emailService, "sendDonationReceipt")
      .mockResolvedValueOnce({
        subject: "Test Subject",
        html: "<p>Test</p>",
        text: "Test",
      });

    (prisma.creator.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 1,
      username: "alice",
      displayName: "Alice Dev",
      user: {
        email: "alice@example.com",
      },
    });

    (prisma.creator.findFirst as jest.Mock).mockResolvedValueOnce({
      username: "bob",
      displayName: "Bob Supporter",
      walletAddress: "GBOB123",
    });

    const donation = fakeDonation({
      id: 42,
      creatorId: 1,
      senderAddress: "GBOB123",
      amount: new Prisma.Decimal(50),
      currency: "XLM",
      message: "Great work!",
      transactionHash: "tx_hash_123",
    });

    const result = await notifyDonationReceived(donation);

    expect(result).toBe(true);
    expect(mockSendReceipt).toHaveBeenCalledWith(
      "alice@example.com",
      expect.objectContaining({
        creatorName: "Alice Dev",
        donorName: "Bob Supporter",
        amount: 50,
        currency: "XLM",
        message: "Great work!",
        transactionHash: "tx_hash_123",
      })
    );
  });

  it("handles anonymous donor and no message gracefully", async () => {
    const mockSendReceipt = jest
      .spyOn(emailService, "sendDonationReceipt")
      .mockResolvedValueOnce({
        subject: "Anonymous Subject",
        html: "<p>Test</p>",
        text: "Test",
      });

    (prisma.creator.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 2,
      username: "coder",
      displayName: null,
      user: {
        email: "coder@example.com",
      },
    });

    const donation = fakeDonation({
      id: 43,
      creatorId: 2,
      senderAddress: "anonymous",
      amount: new Prisma.Decimal(10),
      currency: "USDC",
      message: null,
      transactionHash: null,
    });

    const result = await notifyDonationReceived(donation);

    expect(result).toBe(true);
    expect(mockSendReceipt).toHaveBeenCalledWith(
      "coder@example.com",
      expect.objectContaining({
        creatorName: "coder",
        donorName: null,
        donorAddress: "anonymous",
        amount: 10,
        currency: "USDC",
        message: null,
        transactionHash: null,
      })
    );
  });

  it("skips silently when creator has no email configured", async () => {
    const mockSendReceipt = jest.spyOn(emailService, "sendDonationReceipt");

    (prisma.creator.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 3,
      username: "wallet_only",
      user: {
        email: null,
      },
    });

    const donation = fakeDonation({
      id: 44,
      creatorId: 3,
      senderAddress: "GXYZ",
      amount: new Prisma.Decimal(5),
      currency: "XLM",
      message: null,
      transactionHash: null,
    });

    const result = await notifyDonationReceived(donation);

    expect(result).toBe(false);
    expect(mockSendReceipt).not.toHaveBeenCalled();
  });
});
