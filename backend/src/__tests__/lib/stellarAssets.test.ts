import { Asset, Keypair, Networks } from "@stellar/stellar-sdk";
import { resolveTokenCurrency, resetAssetMappingCache } from "../../lib/stellarAssets";

const ORIGINAL_ENV = { ...process.env };
// A valid StrKey issuer — the SDK rejects a checksum-invalid address.
const ISSUER = Keypair.random().publicKey();

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetAssetMappingCache();
});

describe("resolveTokenCurrency", () => {
  it("returns XLM for an absent token", () => {
    expect(resolveTokenCurrency(undefined)).toBe("XLM");
    expect(resolveTokenCurrency("")).toBe("XLM");
  });

  it("maps the native asset's SAC id to XLM", () => {
    delete process.env.STELLAR_NETWORK;
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    process.env.STELLAR_NETWORK = "testnet";
    resetAssetMappingCache();

    const nativeSac = Asset.native().contractId(Networks.TESTNET);
    expect(resolveTokenCurrency(nativeSac)).toBe("XLM");
  });

  it("derives a credit asset's SAC id from its configured issuer", () => {
    delete process.env.SOROBAN_USDC_TOKEN_ID;
    process.env.SOROBAN_USDC_ISSUER = ISSUER;
    process.env.STELLAR_NETWORK = "testnet";
    resetAssetMappingCache();

    const usdcSac = new Asset("USDC", ISSUER).contractId(Networks.TESTNET);
    expect(resolveTokenCurrency(usdcSac)).toBe("USDC");
  });

  it("prefers an explicit token id over a derived issuer", () => {
    const tokenId = "C".padEnd(56, "A");
    process.env.SOROBAN_USDC_ISSUER = ISSUER;
    process.env.SOROBAN_USDC_TOKEN_ID = tokenId;
    resetAssetMappingCache();

    expect(resolveTokenCurrency(tokenId)).toBe("USDC");
    // The issuer-derived id is not registered once a token id is given.
    expect(resolveTokenCurrency(new Asset("USDC", ISSUER).contractId(Networks.TESTNET))).not.toBe(
      "USDC"
    );
  });

  it("falls back to the raw token for an unrecognized asset", () => {
    resetAssetMappingCache();
    expect(resolveTokenCurrency("CUNKNOWN")).toBe("CUNKNOWN");
  });
});
