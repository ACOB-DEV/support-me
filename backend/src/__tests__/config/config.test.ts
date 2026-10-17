import {
  MissingEnvError,
  assertRequiredEnv,
  getAllowedOrigins,
  getJwtSecret,
  getRateLimitConfig,
} from "../../config";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import {
  validateStellarNetworkSetup,
  validateStellarSetup,
} from "../../services/startupValidation";

describe("required env validation (#178)", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalCorsOrigins = process.env.CORS_ALLOWED_ORIGINS;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalCorsOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = originalCorsOrigins;
  });

  it("refuses to start in production when JWT_SECRET is absent", () => {
    expect(() => assertRequiredEnv()).toThrow(MissingEnvError);
    expect(() => assertRequiredEnv()).toThrow(/JWT_SECRET/);
  });

  it("rejects a blank or whitespace-only JWT_SECRET rather than signing with it", () => {
    process.env.JWT_SECRET = "   ";
    expect(() => getJwtSecret()).toThrow(MissingEnvError);
  });

  it("starts normally once JWT_SECRET is configured", () => {
    process.env.JWT_SECRET = "a-real-configured-secret";
    expect(() => assertRequiredEnv()).not.toThrow();
    expect(getJwtSecret()).toBe("a-real-configured-secret");
  });

  it("trims surrounding whitespace from a configured secret", () => {
    process.env.JWT_SECRET = "  padded-secret  ";
    expect(getJwtSecret()).toBe("padded-secret");
  });

  it("no hardcoded fallback secret is reachable in a non-test code path", () => {
    expect(() => getJwtSecret()).toThrow();
    // The historical default must not be usable as a signing key anywhere.
    expect(process.env.JWT_SECRET).toBeUndefined();
  });

  it("mints and verifies tokens without a configured secret under NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    const secret = getJwtSecret();
    expect(secret).toBeTruthy();
    // Stable within the process so signed and verified tokens agree.
    expect(getJwtSecret()).toBe(secret);
    expect(secret).not.toBe("your-secret-key");
  });
});

describe("CORS origin allowlist (#179)", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCorsOrigins = process.env.CORS_ALLOWED_ORIGINS;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalCorsOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = originalCorsOrigins;
  });

  it("defaults to allowing no browser origin in production when unconfigured", () => {
    expect(getAllowedOrigins()).toEqual([]);
  });

  it("includes the local frontend origins outside production", () => {
    process.env.NODE_ENV = "development";
    expect(getAllowedOrigins()).toContain("http://localhost:3000");
    // `npm run dev` in frontend/ serves https://localhost:3000.
    expect(getAllowedOrigins()).toContain("https://localhost:3000");
  });

  it("parses a comma-separated allowlist and trims whitespace and trailing slashes", () => {
    process.env.CORS_ALLOWED_ORIGINS =
      " https://support-mee.vercel.app/ , https://support-me-git-main.vercel.app ";
    expect(getAllowedOrigins()).toEqual([
      "https://support-mee.vercel.app",
      "https://support-me-git-main.vercel.app",
    ]);
  });

  it("ignores empty entries in the allowlist", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://a.example,,  ,https://b.example";
    expect(getAllowedOrigins()).toEqual(["https://a.example", "https://b.example"]);
  });

  it("de-duplicates repeated origins", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://a.example,https://a.example/";
    expect(getAllowedOrigins()).toEqual(["https://a.example"]);
  });
});

describe("rate limit configuration (#25)", () => {
  const variableNames = [
    "AUTH_RATE_LIMIT_WINDOW_MS",
    "AUTH_RATE_LIMIT_IP_MAX",
    "AUTH_CHALLENGE_RATE_LIMIT_ACCOUNT_MAX",
    "AUTH_VERIFY_RATE_LIMIT_ACCOUNT_MAX",
    "DONATION_RATE_LIMIT_WINDOW_MS",
    "DONATION_RATE_LIMIT_IP_MAX",
    "DONATION_RATE_LIMIT_ACCOUNT_MAX",
    "MAGIC_LINK_RATE_LIMIT_WINDOW_MS",
    "MAGIC_LINK_RATE_LIMIT_IP_MAX",
    "MAGIC_LINK_RATE_LIMIT_ACCOUNT_MAX",
  ];
  const originals = Object.fromEntries(variableNames.map((name) => [name, process.env[name]]));

  beforeEach(() => {
    for (const name of variableNames) delete process.env[name];
  });

  afterAll(() => {
    for (const name of variableNames) {
      const value = originals[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("uses safe defaults when no rate limit variables are set", () => {
    expect(getRateLimitConfig()).toEqual({
      auth: { windowMs: 60_000, ipMax: 30, challengeAccountMax: 5, verifyAccountMax: 10 },
      donation: { windowMs: 60_000, ipMax: 60, accountMax: 20 },
      magicLink: { windowMs: 900_000, ipMax: 30, accountMax: 5 },
    });
  });

  it("reads limits and windows from environment variables", () => {
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = "120000";
    process.env.AUTH_RATE_LIMIT_IP_MAX = "12";
    process.env.DONATION_RATE_LIMIT_ACCOUNT_MAX = "7";
    process.env.MAGIC_LINK_RATE_LIMIT_IP_MAX = "9";

    const config = getRateLimitConfig();
    expect(config.auth.windowMs).toBe(120_000);
    expect(config.auth.ipMax).toBe(12);
    expect(config.donation.accountMax).toBe(7);
    expect(config.magicLink.ipMax).toBe(9);
  });

  it("rejects invalid explicit values", () => {
    process.env.AUTH_RATE_LIMIT_IP_MAX = "0";
    expect(() => getRateLimitConfig()).toThrow(/AUTH_RATE_LIMIT_IP_MAX must be a positive integer/);
  });
});

describe("Stellar network boot validation (#281)", () => {
  const trackedVars = [
    "NODE_ENV",
    "STELLAR_NETWORK",
    "NEXT_PUBLIC_STELLAR_NETWORK",
    "NEXT_PUBLIC_DONATION_CONTRACT_ID",
    "NEXT_PUBLIC_CREATOR_REGISTRY_CONTRACT_ID",
    "EXECUTOR_SECRET_KEY",
  ] as const;
  const originals = Object.fromEntries(trackedVars.map((name) => [name, process.env[name]]));

  const donationContractId =
    "CD6T563YCSYQHDMXC7VCFTKMWMXWHFHAU4NO7EAMFK57QLFI7SSXICYY";
  const validSecret = Keypair.random().secret();

  const matchingProbes = {
    getNetworkPassphraseAt: async () => Networks.TESTNET,
    contractExists: async () => true,
  };

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.STELLAR_NETWORK = "testnet";
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    process.env.NEXT_PUBLIC_DONATION_CONTRACT_ID = donationContractId;
    delete process.env.NEXT_PUBLIC_CREATOR_REGISTRY_CONTRACT_ID;
    process.env.EXECUTOR_SECRET_KEY = validSecret;
  });

  afterAll(() => {
    for (const name of trackedVars) {
      const value = originals[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("accepts endpoints and contracts that match the configured network", async () => {
    const result = await validateStellarSetup(matchingProbes);

    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.summary.network).toBe("testnet");
    expect(result.summary.networkPassphrase).toBe(Networks.TESTNET);
    expect(result.summary.donationContractId).toBe(donationContractId);
    expect(result.summary.executorPublicKey).toBe(
      Keypair.fromSecret(validSecret).publicKey()
    );
  });

  it("flags an endpoint whose passphrase disagrees with the configured network", async () => {
    const result = await validateStellarSetup({
      getNetworkPassphraseAt: async () => Networks.PUBLIC,
      contractExists: async () => true,
    });

    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/passphrase/i);
  });

  it("flags a configured contract that does not exist on the network", async () => {
    const result = await validateStellarSetup({
      getNetworkPassphraseAt: async () => Networks.TESTNET,
      contractExists: async () => false,
    });

    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/does not exist/i);
  });

  it("treats an unreachable endpoint as a warning rather than a fatal problem", async () => {
    const result = await validateStellarSetup({
      getNetworkPassphraseAt: async () => {
        throw new Error("ECONNREFUSED");
      },
      contractExists: async () => true,
    });

    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/could not be validated/i);
  });

  it("flags an executor secret key that is not a parseable Stellar secret", async () => {
    process.env.EXECUTOR_SECRET_KEY = "not-a-valid-secret";

    const result = await validateStellarSetup(matchingProbes);

    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/EXECUTOR_SECRET_KEY/);
  });

  it("fails startup in production on a mismatch but only warns in development", async () => {
    const mismatch = {
      getNetworkPassphraseAt: async () => Networks.PUBLIC,
      contractExists: async () => true,
    };

    process.env.NODE_ENV = "development";
    await expect(validateStellarNetworkSetup(mismatch)).resolves.toBeUndefined();

    process.env.NODE_ENV = "production";
    await expect(validateStellarNetworkSetup(mismatch)).rejects.toThrow(/passphrase/i);
  });
});
