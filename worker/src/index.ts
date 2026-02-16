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

function getRateLimitStatus(ip: string): { limited: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { limited: false, remaining: RATE_LIMIT - 1, resetAt: now + RATE_WINDOW_MS };
  }

  entry.count++;
  const remaining = Math.max(0, RATE_LIMIT - entry.count);
  return { 
    limited: entry.count > RATE_LIMIT, 
    remaining, 
    resetAt: entry.resetAt 
  };
}

async function proxyToRiot(
  riotPath: string, 
  apiKey: string, 
  rateLimitHeaders?: Record<string, string>
): Promise<Response> {
  const riotUrl = `${RIOT_BASE_URL}${riotPath}`;
  const riotRes = await fetch(riotUrl, {
    headers: { "X-Riot-Token": apiKey },
  });

  const body = await riotRes.text();
  return new Response(body, {
    status: riotRes.status,
    headers: {
      ...CORS_HEADERS,
      ...rateLimitHeaders,
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

/** Decode path segment; use raw if invalid (avoids double-encoding and malformed %). */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
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
    const rateLimitStatus = getRateLimitStatus(ip);
    
    const rateLimitHeaders = {
      "X-RateLimit-Limit": RATE_LIMIT.toString(),
      "X-RateLimit-Remaining": rateLimitStatus.remaining.toString(),
      "X-RateLimit-Reset": Math.ceil(rateLimitStatus.resetAt / 1000).toString(),
    };
    
    if (rateLimitStatus.limited) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
        {
          status: 429,
          headers: {
            ...CORS_HEADERS,
            ...rateLimitHeaders,
            "Content-Type": "application/json",
            "Retry-After": Math.ceil((rateLimitStatus.resetAt - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    if (!env.RIOT_API_KEY) {
      return jsonError("Server misconfigured: missing API key", 500);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Route: GET /api/account/{gameName}/{tagLine}
    // Path segments are already encoded (e.g. "John%20Doe"); decode then re-encode so names with spaces work.
    const accountMatch = path.match(/^\/api\/account\/([^/]+)\/([^/]+)$/);
    if (accountMatch) {
      const gameName = safeDecode(accountMatch[1]);
      const tagLine = safeDecode(accountMatch[2]);
      return proxyToRiot(
        `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
        env.RIOT_API_KEY,
        rateLimitHeaders
      );
    }

    // Route: GET /api/matches/{puuid}?count=10&type=ranked&start=0
    const matchesMatch = path.match(/^\/api\/matches\/([^/]+)$/);
    if (matchesMatch) {
      const puuid = safeDecode(matchesMatch[1]);
      const count = url.searchParams.get("count") ?? "10";
      const start = url.searchParams.get("start") ?? "0";
      const type = url.searchParams.get("type") ?? "ranked";
      return proxyToRiot(
        `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?type=${type}&start=${start}&count=${count}`,
        env.RIOT_API_KEY,
        rateLimitHeaders
      );
    }

    // Route: GET /api/match/{matchId}/timeline
    const timelineMatch = path.match(/^\/api\/match\/([^/]+)\/timeline$/);
    if (timelineMatch) {
      const matchId = safeDecode(timelineMatch[1]);
      return proxyToRiot(
        `/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`,
        env.RIOT_API_KEY,
        rateLimitHeaders
      );
    }

    // Route: GET /api/match/{matchId}
    const matchDetailMatch = path.match(/^\/api\/match\/([^/]+)$/);
    if (matchDetailMatch) {
      const matchId = safeDecode(matchDetailMatch[1]);
      return proxyToRiot(
        `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
        env.RIOT_API_KEY,
        rateLimitHeaders
      );
    }

    return jsonError("Not found", 404);
  },
};
