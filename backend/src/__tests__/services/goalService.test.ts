jest.mock("../../prisma", () => ({
  __esModule: true,
  default: {
    goal: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { Prisma } from "@prisma/client";
import prisma from "../../prisma";
import { applyDonationToGoals, computePeriodEnd, resetDueGoals } from "../../services/goalService";

const mockedPrisma = prisma as unknown as {
  goal: { findMany: jest.Mock; update: jest.Mock };
};

// applyDonationToGoals takes a Prisma.TransactionClient — a plain mocked
// object with the same shape works fine since it's only ever used for
// `.goal.findMany`/`.goal.update` calls.
const fakeTransactionClient = () => mockedPrisma as unknown as Prisma.TransactionClient;

describe("applyDonationToGoals", () => {
  it("does nothing when the creator has no active goals in that currency", async () => {
    mockedPrisma.goal.findMany.mockResolvedValue([]);

    await applyDonationToGoals(fakeTransactionClient(), 1, "XLM", 10);

    expect(mockedPrisma.goal.update).not.toHaveBeenCalled();
  });

  it("applies the full donation amount to a single matching active goal", async () => {
    mockedPrisma.goal.findMany.mockResolvedValue([
      { id: 1, creatorId: 1, currency: "XLM", currentAmount: 20, targetAmount: 100, recurring: false, status: "ACTIVE" },
    ]);

    await applyDonationToGoals(fakeTransactionClient(), 1, "XLM", 10);

    expect(mockedPrisma.goal.findMany).toHaveBeenCalledWith({
      where: { creatorId: 1, currency: "XLM", status: "ACTIVE" },
    });
    expect(mockedPrisma.goal.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { currentAmount: 30 },
    });
  });

  it("applies the FULL amount to every matching active goal, not a split", async () => {
    mockedPrisma.goal.findMany.mockResolvedValue([
      { id: 1, creatorId: 1, currency: "XLM", currentAmount: 0, targetAmount: 1000, recurring: false, status: "ACTIVE" },
      { id: 2, creatorId: 1, currency: "XLM", currentAmount: 0, targetAmount: 1000, recurring: false, status: "ACTIVE" },
      { id: 3, creatorId: 1, currency: "XLM", currentAmount: 0, targetAmount: 1000, recurring: false, status: "ACTIVE" },
    ]);

    await applyDonationToGoals(fakeTransactionClient(), 1, "XLM", 50);

    expect(mockedPrisma.goal.update).toHaveBeenCalledTimes(3);
    for (const id of [1, 2, 3]) {
      expect(mockedPrisma.goal.update).toHaveBeenCalledWith({
        where: { id },
        data: { currentAmount: 50 },
      });
    }
  });

  it("marks a non-recurring goal COMPLETED once it reaches its target", async () => {
    mockedPrisma.goal.findMany.mockResolvedValue([
      { id: 1, creatorId: 1, currency: "XLM", currentAmount: 95, targetAmount: 100, recurring: false, status: "ACTIVE" },
    ]);

    await applyDonationToGoals(fakeTransactionClient(), 1, "XLM", 10);

    expect(mockedPrisma.goal.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { currentAmount: 105, status: "COMPLETED" },
    });
  });

  it("does NOT mark a recurring goal COMPLETED when it reaches its target — it keeps accumulating until reset", async () => {
    mockedPrisma.goal.findMany.mockResolvedValue([
      { id: 1, creatorId: 1, currency: "XLM", currentAmount: 95, targetAmount: 100, recurring: true, status: "ACTIVE" },
    ]);

    await applyDonationToGoals(fakeTransactionClient(), 1, "XLM", 10);

    expect(mockedPrisma.goal.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { currentAmount: 105 },
    });
  });

  it("returns only the goals this donation carried to their target", async () => {
    mockedPrisma.goal.findMany.mockResolvedValue([
      { id: 1, creatorId: 1, currency: "XLM", currentAmount: 95, targetAmount: 100, recurring: false, status: "ACTIVE" },
      { id: 2, creatorId: 1, currency: "XLM", currentAmount: 0, targetAmount: 100, recurring: false, status: "ACTIVE" },
    ]);
    mockedPrisma.goal.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));

    const reached = await applyDonationToGoals(fakeTransactionClient(), 1, "XLM", 10);

    expect(reached).toEqual([{ id: 1, currentAmount: 105, status: "COMPLETED" }]);
  });

  it("reports a recurring goal as reached only on the donation that crosses its target", async () => {
    mockedPrisma.goal.findMany.mockResolvedValue([
      { id: 1, creatorId: 1, currency: "XLM", currentAmount: 95, targetAmount: 100, recurring: true, status: "ACTIVE" },
      { id: 2, creatorId: 1, currency: "XLM", currentAmount: 120, targetAmount: 100, recurring: true, status: "ACTIVE" },
    ]);
    mockedPrisma.goal.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));

    const reached = await applyDonationToGoals(fakeTransactionClient(), 1, "XLM", 10);

    expect(reached).toEqual([{ id: 1, currentAmount: 105 }]);
  });

  it("only touches goals denominated in the donated currency", async () => {
    // findMany is already filtered by currency in the query itself, but this
    // asserts the call shape so a regression (e.g. dropping the `currency`
    // filter) is caught even though the mock would otherwise happily return
    // whatever it's told to.
    mockedPrisma.goal.findMany.mockResolvedValue([]);

    await applyDonationToGoals(fakeTransactionClient(), 1, "USDC", 10);

    expect(mockedPrisma.goal.findMany).toHaveBeenCalledWith({
      where: { creatorId: 1, currency: "USDC", status: "ACTIVE" },
    });
  });

  // Issue #18: `currency` is a free-form asset code, not an enum of known
  // assets — a new asset (USDT) needs zero changes here to work, since
  // amounts are tracked per-asset and matched by exact currency string (see
  // the multi-asset design-decision comment at the top of this file).
  it("applies a USDT donation the same way as any other asset — no special-casing needed", async () => {
    mockedPrisma.goal.findMany.mockResolvedValue([
      { id: 1, creatorId: 1, currency: "USDT", currentAmount: 40, targetAmount: 200, recurring: false, status: "ACTIVE" },
    ]);

    await applyDonationToGoals(fakeTransactionClient(), 1, "USDT", 15);

    expect(mockedPrisma.goal.findMany).toHaveBeenCalledWith({
      where: { creatorId: 1, currency: "USDT", status: "ACTIVE" },
    });
    expect(mockedPrisma.goal.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { currentAmount: 55 },
    });
  });
});

describe("computePeriodEnd", () => {
  it("computes a MONTHLY period end 30 days out", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const end = computePeriodEnd("MONTHLY", from);
    expect(end.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("computes a WEEKLY period end 7 days out", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const end = computePeriodEnd("WEEKLY", from);
    expect(end.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });
});

describe("resetDueGoals", () => {
  it("resets currentAmount to 0, reactivates, and rolls currentPeriodEnd forward for every due recurring goal", async () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    mockedPrisma.goal.findMany.mockResolvedValue([
      {
        id: 1,
        recurring: true,
        recurrenceInterval: "MONTHLY",
        currentAmount: 500,
        status: "COMPLETED",
        currentPeriodEnd: new Date("2026-01-31T00:00:00.000Z"),
      },
    ]);

    const count = await resetDueGoals(now);

    expect(mockedPrisma.goal.findMany).toHaveBeenCalledWith({
      where: { recurring: true, currentPeriodEnd: { lte: now } },
    });
    expect(mockedPrisma.goal.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        currentAmount: 0,
        status: "ACTIVE",
        currentPeriodEnd: computePeriodEnd("MONTHLY", now),
      },
    });
    expect(count).toBe(1);
  });

  it("does not touch goals whose period has not yet ended", async () => {
    mockedPrisma.goal.findMany.mockResolvedValue([]);

    const count = await resetDueGoals(new Date("2026-02-01T00:00:00.000Z"));

    expect(mockedPrisma.goal.update).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("resets multiple due goals independently, using each one's own interval", async () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    mockedPrisma.goal.findMany.mockResolvedValue([
      { id: 1, recurring: true, recurrenceInterval: "MONTHLY", currentAmount: 10, status: "ACTIVE", currentPeriodEnd: now },
      { id: 2, recurring: true, recurrenceInterval: "WEEKLY", currentAmount: 20, status: "ACTIVE", currentPeriodEnd: now },
    ]);

    const count = await resetDueGoals(now);

    expect(count).toBe(2);
    expect(mockedPrisma.goal.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { currentAmount: 0, status: "ACTIVE", currentPeriodEnd: computePeriodEnd("MONTHLY", now) },
    });
    expect(mockedPrisma.goal.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { currentAmount: 0, status: "ACTIVE", currentPeriodEnd: computePeriodEnd("WEEKLY", now) },
    });
  });
});
