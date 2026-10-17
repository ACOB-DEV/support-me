import { describe, it, expect } from "vitest";
import {
  parseContractError,
  CONTRACT_ERRORS,
  REGISTRY_ERRORS,
} from "../contract";

describe("parseContractError", () => {
  it("parses Soroban Error(Contract, #N) patterns correctly", () => {
    expect(parseContractError("HostError: Error(Contract, #5)")).toBe(
      CONTRACT_ERRORS[5],
    );
    expect(parseContractError("Error(Contract, #7)")).toBe(CONTRACT_ERRORS[7]);
    expect(parseContractError("Transaction failed: Error(Contract, 8)")).toBe(
      CONTRACT_ERRORS[8],
    );
    expect(parseContractError("Error(Contract, #12)")).toBe(
      CONTRACT_ERRORS[12],
    );
  });

  it("maps known text patterns when no error code is present", () => {
    expect(
      parseContractError(new Error("insufficient balance in account")),
    ).toMatch(/Insufficient balance/i);
    expect(
      parseContractError(new Error("insufficient allowance for spender")),
    ).toMatch(/Insufficient allowance/i);
    expect(
      parseContractError(new Error("contract is currently paused")),
    ).toMatch(/contract is currently paused/i);
    expect(
      parseContractError(new Error("token is not in the allowlist")),
    ).toMatch(/not accepted for donations/i);
  });

  it("returns null for unparseable errors", () => {
    expect(parseContractError(null)).toBeNull();
    expect(parseContractError(undefined)).toBeNull();
    expect(
      parseContractError(new Error("unrecognized internal server fault")),
    ).toBeNull();
  });
});
