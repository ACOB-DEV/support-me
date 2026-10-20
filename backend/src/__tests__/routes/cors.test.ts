jest.mock("../../prisma", () => ({
  __esModule: true,
  default: {
    subscription: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
  },
}));

import request from "supertest";
import app from "../../app";
import { generateToken } from "../../middleware/auth";

const PRODUCTION_ORIGIN = "https://support-mee.vercel.app";
const EVIL_ORIGIN = "https://attacker.example";

describe("CORS allowlist (#179)", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCorsOrigins = process.env.CORS_ALLOWED_ORIGINS;
  const originalJwtSecret = process.env.JWT_SECRET;
  let token: string;

  beforeAll(() => {
    // Mirror a correctly-configured production deploy: a real secret is set,
    // so the startup gate passes and the CORS behavior is what's under test.
    process.env.JWT_SECRET = "test-only-production-shaped-secret";
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = PRODUCTION_ORIGIN;
    token = generateToken(1, null);
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalCorsOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = originalCorsOrigins;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  it("echoes the allowlisted origin so the browser will accept the response", async () => {
    const res = await request(app)
      .options("/api/subscriptions")
      .set("Origin", PRODUCTION_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBeLessThan(400);
    expect(res.headers["access-control-allow-origin"]).toBe(PRODUCTION_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not grant an arbitrary third-party origin access", async () => {
    const res = await request(app)
      .options("/api/subscriptions")
      .set("Origin", EVIL_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("omits the wildcard on an authenticated GET from an unknown origin", async () => {
    const res = await request(app)
      .get("/api/subscriptions")
      .set("Origin", EVIL_ORIGIN)
      .set("Authorization", `Bearer ${token}`);

    // The request is still processed server-side, but without an
    // allow-origin header the browser discards the response, so a malicious
    // page cannot read the authenticated data.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("allows requests that carry no Origin header (server-to-server, probes)", async () => {
    const res = await request(app)
      .get("/api/subscriptions")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
