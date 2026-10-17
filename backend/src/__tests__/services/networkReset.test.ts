jest.mock("../../prisma", () => ({
  __esModule: true,
  default: {
    networkCheckpoint: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("../../services/sorobanRpc", () => ({
  callSorobanRpc: jest.fn(),
}));

jest.mock("../../services/sorobanContracts", () => ({
  contractInstanceExists: jest.fn(),
}));

jest.mock("@sentry/node", () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import prisma from "../../prisma";
import { callSorobanRpc } from "../../services/sorobanRpc";
import { contractInstanceExists } from "../../services/sorobanContracts";
import { LAST_SEEN_LEDGER_KEY, networkReset } from "../../services/networkReset";

const mockedPrisma = prisma as unknown as {
  networkCheckpoint: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
};
const mockedCallRpc = callSorobanRpc as jest.Mock;
const mockedContractExists = contractInstanceExists as jest.Mock;

const DONATION_CONTRACT_ID =
  "CD6T563YCSYQHDMXC7VCFTKMWMXWHFHAU4NO7EAMFK57QLFI7SSXICYY";

describe("network reset detection (#278)", () => {
  const originalContractId = process.env.NEXT_PUBLIC_DONATION_CONTRACT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    networkReset.reset();
    process.env.NEXT_PUBLIC_DONATION_CONTRACT_ID = DONATION_CONTRACT_ID;
    mockedPrisma.networkCheckpoint.upsert.mockResolvedValue({});
    mockedPrisma.networkCheckpoint.deleteMany.mockResolvedValue({ count: 1 });
    mockedContractExists.mockResolvedValue(true);
  });

  afterAll(() => {
    if (originalContractId === undefined) delete process.env.NEXT_PUBLIC_DONATION_CONTRACT_ID;
    else process.env.NEXT_PUBLIC_DONATION_CONTRACT_ID = originalContractId;
  });

  it("advances the ledger checkpoint while the network is healthy", async () => {
    mockedCallRpc.mockResolvedValue({ sequence: 1000 });
    mockedPrisma.networkCheckpoint.findUnique.mockResolvedValue({
      key: LAST_SEEN_LEDGER_KEY,
      value: "900",
    });

    const detected = await networkReset.check();

    expect(detected).toBe(false);
    expect(networkReset.getState().status).toBe("ok");
    expect(mockedPrisma.networkCheckpoint.upsert).toHaveBeenCalledWith({
      where: { key: LAST_SEEN_LEDGER_KEY },
      update: { value: "1000" },
      create: { key: LAST_SEEN_LEDGER_KEY, value: "1000" },
    });
  });

  it("detects a reset when the latest ledger moves backwards past the checkpoint", async () => {
    mockedCallRpc.mockResolvedValue({ sequence: 500 });
    mockedPrisma.networkCheckpoint.findUnique.mockResolvedValue({
      key: LAST_SEEN_LEDGER_KEY,
      value: "900",
    });

    const detected = await networkReset.check();

    expect(detected).toBe(true);
    const state = networkReset.getState();
    expect(state.status).toBe("reset_detected");
    expect(state.reason).toMatch(/lower than the last seen ledger/i);
    expect(state.detectedAt).not.toBeNull();
  });

  it("detects a reset when the donation contract no longer exists on-chain", async () => {
    mockedCallRpc.mockResolvedValue({ sequence: 1000 });
    mockedPrisma.networkCheckpoint.findUnique.mockResolvedValue({
      key: LAST_SEEN_LEDGER_KEY,
      value: "900",
    });
    mockedContractExists.mockResolvedValue(false);

    const detected = await networkReset.check();

    expect(detected).toBe(true);
    expect(networkReset.getState().reason).toMatch(/no longer exists/i);
  });

  it("does not treat an inconclusive contract probe (RPC error) as a reset", async () => {
    mockedCallRpc.mockResolvedValue({ sequence: 1000 });
    mockedPrisma.networkCheckpoint.findUnique.mockResolvedValue({
      key: LAST_SEEN_LEDGER_KEY,
      value: "900",
    });
    mockedContractExists.mockRejectedValue(new Error("RPC unavailable"));

    const detected = await networkReset.check();

    expect(detected).toBe(false);
    expect(networkReset.getState().status).toBe("ok");
  });

  it("fires pause callbacks exactly once and stays sticky after detection", async () => {
    const onPause = jest.fn();
    networkReset.onPause(onPause);
    mockedCallRpc.mockResolvedValue({ sequence: 10 });
    mockedPrisma.networkCheckpoint.findUnique.mockResolvedValue({
      key: LAST_SEEN_LEDGER_KEY,
      value: "900",
    });

    await networkReset.check();
    expect(onPause).toHaveBeenCalledTimes(1);

    // A second pass must not re-run detection or re-fire the callback.
    mockedCallRpc.mockClear();
    const detectedAgain = await networkReset.check();
    expect(detectedAgain).toBe(true);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(mockedCallRpc).not.toHaveBeenCalled();
  });

  it("does not advance or mark a reset when the RPC call fails", async () => {
    mockedCallRpc.mockRejectedValue(new Error("network down"));

    const detected = await networkReset.check();

    expect(detected).toBe(false);
    expect(networkReset.getState().status).toBe("ok");
    expect(mockedPrisma.networkCheckpoint.upsert).not.toHaveBeenCalled();
  });

  it("clears the checkpoint and reset state after a resync", async () => {
    networkReset.markResetDetected("test reset");

    await networkReset.clearAfterResync();

    expect(mockedPrisma.networkCheckpoint.deleteMany).toHaveBeenCalledWith({
      where: { key: LAST_SEEN_LEDGER_KEY },
    });
    expect(networkReset.getState().status).toBe("ok");
  });
});
