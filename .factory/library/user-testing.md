# User Testing

Testing surface, required testing skills/tools, and resource cost classification.

---

## Validation Surface

**Primary surface:** Browser (Next.js web application on localhost:3005)

**Tool:** agent-browser skill
- Confirmed working in dry run
- MUST use semantic locators (`find placeholder`, `find role button --name`, `find text`) — ref-based `@eN` times out on this app's Radix UI components
- Screenshots and DOM inspection both work

**Limitations:**
- `RIOT_API_KEY` may not be available in dev — Riot API calls will fail with "RIOT_API_KEY is not configured"
- Testing focuses on UI state correctness, sync gate behavior, and DB-only flows
- Full end-to-end with real Riot API data requires the key to be set

**App entry point:** http://localhost:3005
- Search form with "Game name" and "Tag line" inputs
- After search, profile page shows match cards, impact stats, sync status bar

## Validation Concurrency

**Machine:** 32 GB RAM, 24 logical cores, ~15 GB free at baseline
**Agent-browser cost:** ~1 GB RAM per instance (Chromium + Node)
**Dev server cost:** ~200 MB RAM (shared across validators)
**Usable headroom:** 15 GB * 0.7 = ~10.5 GB
**Max concurrent validators:** 5 (5 * 1 GB + 0.2 GB = 5.2 GB, well within budget)

## Testing Notes

- The dev server must be running on port 3005 before testing
- The Validation Fixture ("Validation Fixture#LOCAL") bypasses sync gate entirely — use it for UI-only testing
- For sync gate behavior testing, need actual player data in the DB or mock the sync status API responses
