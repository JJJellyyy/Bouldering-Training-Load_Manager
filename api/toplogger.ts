type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => {
    json: (body: unknown) => unknown;
    send: (body: string) => unknown;
  };
  setHeader: (name: string, value: string) => unknown;
};

const TOPLOGGER_GRAPHQL_ENDPOINT = "https://app.toplogger.nu/graphql";
const MAX_BODY_BYTES = 20_000;

/**
 * Thin proxy to TopLogger's GraphQL API. TopLogger only allows CORS from its own web app,
 * so the browser cannot call it directly. Nothing is stored here; the caller's bearer token is forwarded as-is.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ errors: [{ message: "Method not allowed" }] });
  }

  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  if (body.length > MAX_BODY_BYTES) {
    return res.status(413).json({ errors: [{ message: "Request too large" }] });
  }

  const authorization = req.headers.authorization;

  try {
    const response = await fetch(TOPLOGGER_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(typeof authorization === "string" ? { Authorization: authorization } : {}),
      },
      body,
    });

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(response.status).send(await response.text());
  } catch (error) {
    console.error("TopLogger proxy error:", error);
    return res.status(502).json({ errors: [{ message: "Could not reach TopLogger" }] });
  }
}
