import { Prisma } from "@prisma/client";
import { buildCreatorStats } from "../../services/creatorStats";

const d = (v: string) => new Prisma.Decimal(v);

describe("buildCreatorStats (#224)", () => {
  it("returns zeroed stats when there are no donations", () => {
    expect(buildCreatorStats([], [])).toEqual({
      donationCount: 0,
      uniqueSupporters: 0,
      currencies: [],
    });
  });

  it("reports per-currency totals, averages and largest tips", () => {
    const stats = buildCreatorStats(
      [
        {
          currency: "XLM",
          _count: { _all: 3 },
          _sum: { amount: d("35.5") },
          _avg: { amount: d("11.8333333") },
          _max: { amount: d("20") },
        },
        {
          currency: "USDC",
          _count: { _all: 2 },
          _sum: { amount: d("7.0000001") },
          _avg: { amount: d("3.50000005") },
          _max: { amount: d("5") },
        },
      ],
      [
        { currency: "XLM", senderAddress: "GA" },
        { currency: "XLM", senderAddress: "GB" },
        { currency: "USDC", senderAddress: "GA" },
      ]
    );

    expect(stats.donationCount).toBe(5);
    // GA tipped in both currencies but is one supporter overall.
    expect(stats.uniqueSupporters).toBe(2);
    expect(stats.currencies).toEqual([
      {
        currency: "USDC",
        total: 7.0000001,
        donationCount: 2,
        uniqueSupporters: 1,
        average: 3.50000005,
        largest: 5,
      },
      {
        currency: "XLM",
        total: 35.5,
        donationCount: 3,
        uniqueSupporters: 2,
        average: 11.8333333,
        largest: 20,
      },
    ]);
  });

  it("handles custom tokens and null aggregates", () => {
    const stats = buildCreatorStats(
      [
        {
          currency: "MYTOKEN",
          _count: { _all: 0 },
          _sum: { amount: null },
          _avg: { amount: null },
          _max: { amount: null },
        },
      ],
      []
    );
    expect(stats.currencies[0]).toEqual({
      currency: "MYTOKEN",
      total: 0,
      donationCount: 0,
      uniqueSupporters: 0,
      average: 0,
      largest: 0,
    });
  });
});
