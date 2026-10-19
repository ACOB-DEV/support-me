import { Router, Request, Response } from "express";
import { emailService, EmailTemplateName, TemplateContextMap } from "../services/email/emailService";
import { NotFoundError } from "../errors/AppError";

const router = Router();

const APP_URL = (process.env.APP_URL || "https://localhost:3000").replace(/\/$/, "");

interface MockGenerators {
  [key: string]: (query: Request["query"]) => unknown;
}

const mockGenerators: MockGenerators = {
  "donation-receipt": (query) => {
    const isAnonymous = query.anonymous === "true";
    return {
      creatorName: (query.creator as string) || "stellar_coder",
      donorName: isAnonymous ? null : (query.donor as string) || "Alice Johnson",
      donorAddress: isAnonymous
        ? null
        : (query.donorAddress as string) || "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWAC",
      amount: query.amount ? parseFloat(query.amount as string) : 25.5,
      currency: (query.currency as string) || "XLM",
      message:
        query.noMessage === "true"
          ? null
          : (query.message as string) || "Thanks for building amazing open-source tools!",
      timestamp: new Date(),
      transactionHash:
        query.noTx === "true"
          ? null
          : (query.txHash as string) ||
            "8f73111b7d722d4f07e59bbfbe5980076de11726a26d70c4ec31dbdb4c87cb72",
      dashboardUrl: `${APP_URL}/dashboard`,
    };
  },
  "subscription-renewed": (query) => ({
    creatorName: (query.creator as string) || "stellar_coder",
    amount: query.amount ? parseFloat(query.amount as string) : 10,
    token: (query.currency as string) || "USDC",
    intervalSecs: query.interval ? parseInt(query.interval as string, 10) : 2592000,
    manageUrl: `${APP_URL}/app/subscriptions`,
    txHash:
      (query.txHash as string) ||
      "8f73111b7d722d4f07e59bbfbe5980076de11726a26d70c4ec31dbdb4c87cb72",
    nextChargeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  }),
  "subscription-failed": (query) => ({
    creatorName: (query.creator as string) || "stellar_coder",
    amount: query.amount ? parseFloat(query.amount as string) : 10,
    token: (query.currency as string) || "USDC",
    intervalSecs: query.interval ? parseInt(query.interval as string, 10) : 2592000,
    manageUrl: `${APP_URL}/app/subscriptions`,
    error: (query.error as string) || "allowance revoked or expired",
  }),
  welcome: (query) => ({
    username: (query.username as string) || "stellar_creator",
    profileUrl: `${APP_URL}/${(query.username as string) || "stellar_creator"}`,
    dashboardUrl: `${APP_URL}/dashboard`,
  }),
};

/**
 * List all available email templates with preview links.
 */
router.get("/", (req: Request, res: Response) => {
  const templates = Object.keys(mockGenerators);

  if (req.query.format === "json") {
    return res.json({ templates });
  }

  const itemsHtml = templates
    .map((name) => {
      const variants =
        name === "donation-receipt"
          ? ` &middot; <a href="/api/email/preview/${name}?anonymous=true" style="color:#0284c7;text-decoration:none;">(Anonymous Variant)</a> &middot; <a href="/api/email/preview/${name}?noMessage=true" style="color:#0284c7;text-decoration:none;">(No-Message Variant)</a>`
          : "";
      return `
        <li style="margin:12px 0;font-size:16px;">
          <a href="/api/email/preview/${name}" style="color:#0284c7;text-decoration:none;font-weight:600;">${name}</a>
          ${variants}
          <div style="font-size:12px;color:#78716c;margin-top:4px;">
            Formats:
            <a href="/api/email/preview/${name}?format=html" style="color:#78716c;">html</a> &middot;
            <a href="/api/email/preview/${name}?format=json" style="color:#78716c;">json</a> &middot;
            <a href="/api/email/preview/${name}?format=text" style="color:#78716c;">text</a>
          </div>
        </li>
      `;
    })
    .join("");

  const indexHtml = `<!doctype html>
<html>
  <head>
    <title>SupportMe - Email Template Previewer</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fafaf9; color: #1c1917; padding: 40px 20px; margin: 0; }
      .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px; border-radius: 12px; border: 1px solid #e7e5e4; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      h1 { margin: 0 0 8px; font-size: 24px; font-weight: 800; }
      p { color: #78716c; margin: 0 0 24px; font-size: 14px; }
      ul { list-style: none; padding: 0; margin: 0; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>SupportMe Email Previewer</h1>
      <p>Preview and test transactional email templates locally without sending real email.</p>
      <ul>
        ${itemsHtml}
      </ul>
    </div>
  </body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'");
  return res.send(indexHtml);
});

/**
 * Preview a specific email template with mock or query-param driven data.
 */
router.get("/:template", (req: Request, res: Response) => {
  const { template } = req.params;
  const generator = mockGenerators[template];

  if (!generator) {
    throw new NotFoundError(
      `Email template "${template}" not found. Available templates: ${Object.keys(
        mockGenerators
      ).join(", ")}`
    );
  }

  const context = generator(req.query);
  // `template` is a runtime-checked key into `mockGenerators` (validated by
  // the `!generator` check above), so the specific `TemplateContextMap`
  // member it maps to can't be narrowed from a plain `string` — mirrors the
  // per-branch casts `EmailService.render` itself already uses internally.
  const rendered = emailService.render(
    template as EmailTemplateName,
    context as TemplateContextMap[EmailTemplateName]
  );

  const format = (req.query.format as string) || "html";
  if (format === "json") {
    return res.json({
      template,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      context,
    });
  }

  if (format === "text") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Robots-Tag", "noindex");
    return res.send(rendered.text);
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'");
  return res.send(rendered.html);
});

export default router;
