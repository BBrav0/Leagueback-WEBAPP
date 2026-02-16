interface Env {
  RIOT_API_KEY: string;
}

const RIOT_BASE_URL = "https://americas.api.riotgames.com";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Simple per-IP rate limiter (resets when worker instance recycles)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // requests per window
const RATE_WINDOW_MS = 60_000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT;
}

async function proxyToRiot(riotPath: string, apiKey: string): Promise<Response> {
  const riotUrl = `${RIOT_BASE_URL}${riotPath}`;
  const riotRes = await fetch(riotUrl, {
    headers: { "X-Riot-Token": apiKey },
  });

  const body = await riotRes.text();
  return new Response(body, {
    status: riotRes.status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": riotRes.headers.get("Content-Type") ?? "application/json",
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return jsonError("Method not allowed", 405);
    }

    // Rate limiting
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (isRateLimited(ip)) {
      return jsonError("Rate limit exceeded. Try again later.", 429);
    }

    if (!env.RIOT_API_KEY) {
      return jsonError("Server misconfigured: missing API key", 500);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Route: GET /api/account/{gameName}/{tagLine}
    const accountMatch = path.match(/^\/api\/account\/([^/]+)\/([^/]+)$/);
    if (accountMatch) {
      const [, gameName, tagLine] = accountMatch;
      return proxyToRiot(
        `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
        env.RIOT_API_KEY
      );
    }

    // Route: GET /api/matches/{puuid}?count=10&type=ranked
    const matchesMatch = path.match(/^\/api\/matches\/([^/]+)$/);
    if (matchesMatch) {
      const [, puuid] = matchesMatch;
      const count = url.searchParams.get("count") ?? "10";
      const type = url.searchParams.get("type") ?? "ranked";
      return proxyToRiot(
        `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?type=${type}&start=0&count=${count}`,
        env.RIOT_API_KEY
      );
    }

    // Route: GET /api/match/{matchId}/timeline
    const timelineMatch = path.match(/^\/api\/match\/([^/]+)\/timeline$/);
    if (timelineMatch) {
      const [, matchId] = timelineMatch;
      return proxyToRiot(
        `/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`,
        env.RIOT_API_KEY
      );
    }

    // Route: GET /api/match/{matchId}
    const matchDetailMatch = path.match(/^\/api\/match\/([^/]+)$/);
    if (matchDetailMatch) {
      const [, matchId] = matchDetailMatch;
      return proxyToRiot(
        `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
        env.RIOT_API_KEY
      );
    }

    return jsonError("Not found", 404);
  },
};
