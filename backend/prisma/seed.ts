import { PrismaClient, RecurrenceInterval } from "@prisma/client";
import { getFriendbotUrl, isTestnetLike } from "../src/services/stellarNetwork";

/**
 * Idempotent testnet demo seed (#280).
 *
 * Gives a fresh database enough creators, goals, donations, one recurring
 * subscription and one withdrawal to exercise the whole app without a real
 * wallet or on-chain activity. Every row is upserted on a stable natural key,
 * so running it twice produces no duplicates and no errors.
 *
 * The wallet addresses are public keys only — no secret keys are stored, and
 * the `--fund` flag uses Friendbot to put testnet XLM in them for UI work.
 *
 * Guarded: refuses to run against NODE_ENV=production unless SEED_FORCE=true,
 * so this can never be pointed at a real deployment by accident.
 */

const prisma = new PrismaClient();

// Public testnet addresses, deliberately keyless (Wallet A..F).
const CREATOR_WALLETS = [
  "GD5F25YBNKSE6MOROMM4RCV6PHATS7M7ALCOTO7E6KIANCBTK5PFZ32O",
  "GBJ5YTPUO7VC3WCCQTXRQT26YJBKX6XCGP3P77AVZIG3ZFTHCYQMK3IC",
  "GDGGLRBDB22X63VECXDWG7J3EER63P4VP7GLEEZKPASNJV36S7T2BBNO",
];
const SUPPORTER_WALLETS = [
  "GAK6ANIWF5H6MJ45TJHMECS3QWRBFSUZ2SJDJDU7A4RG2PLOOLJXD46K",
  "GCDFV6FKD6QUD6OGOIBLZFV53TERHLEA3BJUE25YTW6UECKLR5SKYJQ3",
  "GA3ZYFW2ATP3H2OFK3JZP5ZGF2PO5WUVM4TTMDGBYCD2RHLNE26ZO5H2",
];

const DAY_MS = 24 * 60 * 60 * 1000;

const creators = [
  {
    username: "cleo",
    displayName: "Cleo Adeyemi",
    bio: "Indie game developer raising money for a new art tablet.",
    walletAddress: CREATOR_WALLETS[0],
    email: "cleo@example.test",
    goals: [
      {
        title: "New art tablet",
        description: "A bigger drawing tablet for the next game.",
        targetAmount: 400,
        currentAmount: 0,
        currency: "XLM",
        recurring: false,
        recurrenceInterval: null,
        currentPeriodEnd: null,
      },
    ],
    donations: [
      {
        onChainEventId: "seed:don:cleo:1",
        transactionHash: "seed-tx-cleo-1",
        senderAddress: SUPPORTER_WALLETS[0],
        amount: "125.0000000",
        currency: "XLM",
        message: "Can't wait to play it!",
      },
      {
        onChainEventId: "seed:don:cleo:2",
        transactionHash: "seed-tx-cleo-2",
        senderAddress: SUPPORTER_WALLETS[1],
        amount: "40.0000000",
        currency: "USDC",
        message: "For the tablet fund.",
      },
    ],
    withdrawals: [
      {
        anchorTxId: "seed-anchor-cleo-1",
        amountIn: "50.0000000",
        currency: "USDC",
        status: "completed",
      },
    ],
  },
  {
    username: "maeve",
    displayName: "Maeve O'Brien",
    bio: "Community gardener keeping the neighbourhood plot running.",
    walletAddress: CREATOR_WALLETS[1],
    email: "maeve@example.test",
    goals: [
      {
        title: "Monthly supplies",
        description: "Seeds, compost and tools every month.",
        targetAmount: 120,
        currentAmount: 0,
        currency: "XLM",
        recurring: true,
        recurrenceInterval: RecurrenceInterval.MONTHLY,
        currentPeriodEnd: new Date(Date.now() + 20 * DAY_MS),
      },
    ],
    donations: [
      {
        onChainEventId: "seed:don:maeve:1",
        transactionHash: "seed-tx-maeve-1",
        senderAddress: SUPPORTER_WALLETS[2],
        amount: "30.0000000",
        currency: "XLM",
        message: "Keep the garden growing.",
      },
    ],
    withdrawals: [],
  },
  {
    username: "jomar",
    displayName: "Jomar Santos",
    bio: "Busking cellist funding a small studio recording.",
    walletAddress: CREATOR_WALLETS[2],
    email: "jomar@example.test",
    goals: [
      {
        title: "Studio time",
        description: "Eight hours of studio time to record the EP.",
        targetAmount: 300,
        currentAmount: 0,
        currency: "USDC",
        recurring: false,
        recurrenceInterval: null,
        currentPeriodEnd: null,
      },
    ],
    donations: [
      {
        onChainEventId: "seed:don:jomar:1",
        transactionHash: "seed-tx-jomar-1",
        senderAddress: SUPPORTER_WALLETS[0],
        amount: "75.0000000",
        currency: "USDC",
        message: "Absolute banger last night.",
      },
    ],
    withdrawals: [],
  },
];

// One recurring subscription, deliberately due in the future so a running
// executor does not try to charge a subscription that has no on-chain
// counterpart.
const subscriptions = [
  {
    creatorUsername: "maeve",
    onChainId: 9001,
    supporterAddress: SUPPORTER_WALLETS[0],
    token: "XLM",
    amount: "5.0000000",
    intervalSecs: 30 * 24 * 60 * 60,
    nextChargeAt: new Date(Date.now() + 30 * DAY_MS),
  },
];

async function fundWallets(addresses: string[]): Promise<void> {
  if (!isTestnetLike()) {
    console.log("Skipping --fund: not running against a testnet-like network.");
    return;
  }
  for (const address of addresses) {
    const url = `${getFriendbotUrl()}?addr=${encodeURIComponent(address)}`;
    try {
      const response = await fetch(url, { method: "GET" });
      console.log(
        response.ok
          ? `Friendbot funded ${address}`
          : `Friendbot returned HTTP ${response.status} for ${address}`
      );
    } catch (error) {
      console.warn(`Friendbot request failed for ${address}: ${(error as Error).message}`);
    }
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.SEED_FORCE !== "true") {
    console.error(
      "Refusing to seed a production database. Set SEED_FORCE=true if you really mean it."
    );
    process.exit(1);
  }

  for (const spec of creators) {
    const user = await prisma.user.upsert({
      where: { walletAddress: spec.walletAddress },
      update: { email: spec.email },
      create: { walletAddress: spec.walletAddress, email: spec.email },
    });

    const creator = await prisma.creator.upsert({
      where: { username: spec.username },
      update: {
        userId: user.id,
        displayName: spec.displayName,
        bio: spec.bio,
        walletAddress: spec.walletAddress,
      },
      create: {
        userId: user.id,
        username: spec.username,
        displayName: spec.displayName,
        bio: spec.bio,
        walletAddress: spec.walletAddress,
      },
    });

    // Goals have no natural unique key, so match on (creatorId, title).
    for (const goal of spec.goals) {
      const existing = await prisma.goal.findFirst({
        where: { creatorId: creator.id, title: goal.title },
      });
      if (existing) {
        await prisma.goal.update({ where: { id: existing.id }, data: goal });
      } else {
        await prisma.goal.create({ data: { ...goal, creatorId: creator.id } });
      }
    }

    // `verified: true` so seeded donations appear as settled activity; the
    // stable onChainEventId makes the upsert idempotent.
    for (const donation of spec.donations) {
      await prisma.donation.upsert({
        where: { onChainEventId: donation.onChainEventId },
        update: {},
        create: {
          ...donation,
          creatorId: creator.id,
          operationIndex: 0,
          eventIndex: 0,
          verified: true,
        },
      });
    }

    for (const withdrawal of spec.withdrawals) {
      await prisma.withdrawal.upsert({
        where: {
          creatorId_anchorTxId: {
            creatorId: creator.id,
            anchorTxId: withdrawal.anchorTxId,
          },
        },
        update: {},
        create: { ...withdrawal, creatorId: creator.id },
      });
    }

    console.log(`Seeded creator @${spec.username} (${spec.donations.length} donations)`);
  }

  for (const sub of subscriptions) {
    const creator = await prisma.creator.findUnique({
      where: { username: sub.creatorUsername },
    });
    if (!creator) continue;
    await prisma.subscription.upsert({
      where: { onChainId: sub.onChainId },
      update: {},
      create: {
        creatorId: creator.id,
        supporterAddress: sub.supporterAddress,
        token: sub.token,
        amount: sub.amount,
        intervalSecs: sub.intervalSecs,
        onChainId: sub.onChainId,
        nextChargeAt: sub.nextChargeAt,
        active: true,
      },
    });
    console.log(`Seeded subscription #${sub.onChainId} for @${sub.creatorUsername}`);
  }

  if (process.argv.includes("--fund")) {
    await fundWallets([...CREATOR_WALLETS, ...SUPPORTER_WALLETS]);
  }

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
