import request from "supertest";
import app from "../../app";

describe("Email Preview Router", () => {
  describe("production gate", () => {
    const originalEnv = process.env.NODE_ENV;

    afterAll(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it("returns 404 in production when EMAIL_PREVIEW_ENABLED is not set", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.EMAIL_PREVIEW_ENABLED;

      const res = await request(app).get("/api/email/preview");
      expect(res.status).toBe(404);
    });

    it("returns 200 in production when EMAIL_PREVIEW_ENABLED is true", async () => {
      process.env.NODE_ENV = "production";
      process.env.EMAIL_PREVIEW_ENABLED = "true";

      const res = await request(app).get("/api/email/preview");
      expect(res.status).toBe(200);
    });

    it("returns 200 in development by default", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.EMAIL_PREVIEW_ENABLED;

      const res = await request(app).get("/api/email/preview");
      expect(res.status).toBe(200);
    });
  });
  it("GET /api/email/preview returns 200 HTML with list of templates", async () => {
    const res = await request(app).get("/api/email/preview");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("SupportMe Email Previewer");
    expect(res.text).toContain("donation-receipt");
    expect(res.text).toContain("subscription-renewed");
    expect(res.text).toContain("subscription-failed");
  });

  it("GET /api/email/preview?format=json returns template names", async () => {
    const res = await request(app).get("/api/email/preview?format=json");
    expect(res.status).toBe(200);
    expect(res.body.templates).toContain("donation-receipt");
    expect(res.body.templates).toContain("subscription-renewed");
  });

  it("GET /api/email/preview/donation-receipt renders HTML by default", async () => {
    const res = await request(app).get("/api/email/preview/donation-receipt");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("New Donation Received!");
  });

  it("GET /api/email/preview/donation-receipt?anonymous=true renders anonymous variant", async () => {
    const res = await request(app).get("/api/email/preview/donation-receipt?anonymous=true");
    expect(res.status).toBe(200);
    expect(res.text).toContain("New Anonymous Donation!");
    expect(res.text).toContain("An anonymous supporter");
  });

  it("GET /api/email/preview/donation-receipt?format=json returns rendered components and context", async () => {
    const res = await request(app).get("/api/email/preview/donation-receipt?format=json");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("subject");
    expect(res.body).toHaveProperty("html");
    expect(res.body).toHaveProperty("text");
    expect(res.body).toHaveProperty("context");
  });

  it("GET /api/email/preview/donation-receipt?format=text returns plain text", async () => {
    const res = await request(app).get("/api/email/preview/donation-receipt?format=text");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("--- DONATION RECEIPT ---");
  });

  it("GET /api/email/preview/unknown-template returns 404", async () => {
    const res = await request(app).get("/api/email/preview/non-existent-template");
    expect(res.status).toBe(404);
  });
});
