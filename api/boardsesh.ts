type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => {
    json: (body: unknown) => unknown;
    send: (body: string) => unknown;
  };
  setHeader: (name: string, value: string) => unknown;
};

const BOARDSESH_GRAPHQL_ENDPOINT = "https://ws.boardsesh.com/graphql";
const MAX_BODY_BYTES = 10_000;
/** The only operations this app sends: public, read-only logbook data. */
const ALLOWED_OPERATIONS = new Set(["publicProfile", "searchUsers", "boardseshFeed"]);

/**
 * Read-only proxy to Boardsesh's public GraphQL API. Boardsesh only allows CORS from its own sites, so the browser
 * can't call it directly. No credentials are accepted or forwarded and only the allowed queries pass, keeping this
 * within Boardsesh's integration terms (reading a climber's own public logbook).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ errors: [{ message: "Method not allowed" }] });
  }

  let payload: { query?: unknown; variables?: unknown };
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : ((req.body ?? {}) as typeof payload);
  } catch {
    return res.status(400).json({ errors: [{ message: "Invalid JSON" }] });
  }

  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  const operation = query.match(/^query\s+([A-Za-z]+)/)?.[1];
  if (!operation || !ALLOWED_OPERATIONS.has(operation) || /\b(mutation|subscription)\b/.test(query)) {
    return res.status(403).json({ errors: [{ message: "Operation not allowed" }] });
  }

  const body = JSON.stringify({ query, variables: payload.variables ?? {} });
  if (body.length > MAX_BODY_BYTES) {
    return res.status(413).json({ errors: [{ message: "Request too large" }] });
  }

  try {
    const response = await fetch(BOARDSESH_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BoulderLoadManager/1.0 (+https://boulder-load-manager.vercel.app)",
      },
      body,
    });

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(response.status).send(await response.text());
  } catch (error) {
    console.error("Boardsesh proxy error:", error);
    return res.status(502).json({ errors: [{ message: "Could not reach Boardsesh" }] });
  }
}
