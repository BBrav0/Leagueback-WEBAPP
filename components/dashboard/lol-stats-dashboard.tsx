"use client"

import { useState, useEffect } from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis, ReferenceArea, PieChart, Pie, Cell } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { BackendBridge, MatchSummary } from "@/lib/bridge"
import { cn } from "@/lib/utils"
import { rateLimiter } from "@/lib/rate-limiter"


const chartConfig = {
  yourImpact: {
    label: "Your Impact",
    color: "#FFFDD0",
  },
  teamImpact: {
    label: "Team Impact",
    color: "#FDB813",
  },
}

// Impact overview pie-chart color config
const pieConfig = {
  impactWins: {
    label: "Impact Wins",
    color: "#22c55e", // Green
  },
  impactLosses: {
    label: "Impact Losses",
    color: "#ef4444", // Red
  },
  guaranteedWins: {
    label: "Guaranteed Wins",
    color: "#3b82f6", // Blue
  },
  guaranteedLosses: {
    label: "Guaranteed Losses",
    color: "#fde047", // Yellow
  },
} as const

// Type describing the aggregate counts for each category
type ImpactCounts = {
  impactWins: number
  impactLosses: number
  guaranteedWins: number
  guaranteedLosses: number
}

// LocalStorage key for match impact cache
const IMPACT_CACHE_KEY = "matchImpactCache_v1" as const;

// Category helper type
type ImpactCategory = keyof ImpactCounts;

// ===== Helper functions =====
function classifyMatch(match: MatchSummary): ImpactCategory {
  const youHigher = match.yourImpact > match.teamImpact;
  const win = match.gameResult === "Victory";

  if (win && youHigher) return "impactWins";
  if (!win && !youHigher) return "impactLosses";
  if (!win && youHigher) return "guaranteedLosses";
  return "guaranteedWins"; // win && !youHigher
}

function loadImpactCache(): Record<string, ImpactCategory> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(IMPACT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ImpactCategory>) : {};
  } catch {
    return {};
  }
}

function saveImpactCache(cache: Record<string, ImpactCategory>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(IMPACT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

function ImpactPieChart({ counts }: { counts: ImpactCounts }) {
  const pieData: { name: keyof typeof pieConfig; value: number }[] = [
    { name: "impactWins", value: counts.impactWins },
    { name: "impactLosses", value: counts.impactLosses },
    { name: "guaranteedWins", value: counts.guaranteedWins },
    { name: "guaranteedLosses", value: counts.guaranteedLosses },
  ]

  const total = pieData.reduce((acc, cur) => acc + cur.value, 0);

  return (
    <ChartContainer
      config={pieConfig}
      className="h-[300px] w-full justify-center"
    >
      <PieChart>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={110}
          paddingAngle={2}
          strokeWidth={0}
          label={({ name, value }) => {
            const percent = total > 0 ? ((value as number) / total) * 100 : 0;
            return `${pieConfig[name as keyof typeof pieConfig].label} ${percent.toFixed(0)}%`;
          }}
          labelLine={false}
        >
          {pieData.map((entry) => (
            <Cell
              key={`cell-${entry.name}`}
              fill={pieConfig[entry.name as keyof typeof pieConfig].color}
            />
          ))}
        </Pie>
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
      </PieChart>
    </ChartContainer>
  )
}

function MatchChart({ data }: { data: MatchSummary["data"] }) {
  const roundedData = data.map((d) => ({
    ...d,
    yourImpact: Number(d.yourImpact.toFixed(1)),
    teamImpact: Number(d.teamImpact.toFixed(1)),
  }));

  const allValues = roundedData.flatMap(d => [d.yourImpact || 0, d.teamImpact || 0]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);

  return (
    <ChartContainer config={chartConfig} className="h-[250px] w-full justify-start">
      <LineChart
        data={roundedData}
        margin={{
          top: 10,
          left: -25,
          right: 10,
          bottom: 10,
        }}
      >
        <defs>
          <linearGradient id="positiveGradient" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgba(34, 197, 94, 0.3)" />
            <stop offset="100%" stopColor="rgba(34, 197, 94, 0.9)" />
          </linearGradient>
          <linearGradient id="negativeGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(239, 68, 68, 0.30)" />
            <stop offset="100%" stopColor="rgba(239, 68, 68, 0.9)" />
          </linearGradient>
        </defs>

        <ReferenceArea y1={0} y2={maxValue + 10} fill="url(#positiveGradient)" />
        <ReferenceArea y1={minValue - 10} y2={0} fill="url(#negativeGradient)" />

        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" opacity={0.3} />
        <XAxis
          dataKey="minute"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickFormatter={(value) => (value === 35 ? "Final" : `${value}m`)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          domain={["dataMin - 10", "dataMax + 10"]}
        />
        <ChartTooltip
          cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
          content={<ChartTooltipContent labelFormatter={(value) => (value === 35 ? "Final" : `Minute ${value}`)} />}
        />
        <Line
          dataKey="yourImpact"
          type="monotone"
          stroke={chartConfig.yourImpact.color}
          strokeWidth={2}
          dot={{ fill: chartConfig.yourImpact.color, strokeWidth: 1, r: 3 }}
        />
        <Line
          dataKey="teamImpact"
          type="monotone"
          strokeDasharray="5 5"
          stroke={chartConfig.teamImpact.color}
          strokeWidth={2}
          dot={{ fill: chartConfig.teamImpact.color, strokeWidth: 1, r: 3 }}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  )
}

export default function Component() {
  const [matchesData, setMatchesData] = useState<MatchSummary[]>([]);
  const [impactCounts, setImpactCounts] = useState<ImpactCounts>({
    impactWins: 0,
    impactLosses: 0,
    guaranteedWins: 0,
    guaranteedLosses: 0,
  });
  const [lifetimeCounts, setLifetimeCounts] = useState<ImpactCounts>(() => {
    const cache = loadImpactCache();
    const counts: ImpactCounts = {
      impactWins: 0,
      impactLosses: 0,
      guaranteedWins: 0,
      guaranteedLosses: 0,
    };
    Object.values(cache).forEach((cat) => {
      counts[cat]++;
    });
    return counts;
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameName, setGameName] = useState("");
  const [tagLine, setTagLine] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPuuid, setCurrentPuuid] = useState<string | null>(null);
  const [hasMoreMatches, setHasMoreMatches] = useState(false);
  const [matchesStart, setMatchesStart] = useState(0);
  const [rateLimitStatus, setRateLimitStatus] = useState<{ remaining: number; resetAt: number } | null>(null);

  const handleSearch = async () => {
    if (!gameName || !tagLine) {
      setError("Please enter both game name and tag line");
      return;
    }

    // Check rate limit before starting
    const rateLimitCheck = rateLimiter.getStatus();
    if (!rateLimitCheck.allowed) {
      setError(`Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds.`);
      return;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setMatchesStart(0);
    setHasMoreMatches(false);

    try {
      // Get account first to get puuid
      const account = await BackendBridge.getAccount(gameName, tagLine);
      if (!account) {
        throw new Error("Failed to get account information");
      }

      setCurrentPuuid(account.puuid);

      // Load initial batch of 5 matches
      const result = await BackendBridge.getPlayerMatchDataBatch(
        account.puuid,
        0,
        5,
        1500
      );

      const impactCache = loadImpactCache();

      // Add new matches to cache
      result.matches.forEach((m) => {
        const category = classifyMatch(m);
        if (!impactCache[m.id]) {
          impactCache[m.id] = category;
        }
      });

      saveImpactCache(impactCache);

      // Calculate counts for all displayed matches
      const counts: ImpactCounts = {
        impactWins: 0,
        impactLosses: 0,
        guaranteedWins: 0,
        guaranteedLosses: 0,
      };
      result.matches.forEach((m) => {
        const category = classifyMatch(m);
        counts[category]++;
      });

      // Calculate lifetime counts from entire cache
      const newLifetime: ImpactCounts = {
        impactWins: 0,
        impactLosses: 0,
        guaranteedWins: 0,
        guaranteedLosses: 0,
      };
      Object.values(impactCache).forEach((cat) => {
        newLifetime[cat]++;
      });

      setLifetimeCounts(newLifetime);
      setImpactCounts(counts);
      setMatchesData(result.matches);
      setHasMoreMatches(result.hasMore);
      setMatchesStart(result.nextStart);
      setRateLimitStatus({ remaining: rateLimiter.getStatus().remaining, resetAt: rateLimiter.getStatus().resetAt });

      if (result.matches.length === 0) {
        setError("No matches found for this player");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch match data");
      setMatchesData([]);
      setCurrentPuuid(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!currentPuuid || loadingMore) return;

    // Check rate limit
    const rateLimitCheck = rateLimiter.checkRateLimit();
    if (!rateLimitCheck.allowed) {
      setError(`Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds.`);
      return;
    }

    setLoadingMore(true);
    setError(null);

    try {
      const result = await BackendBridge.getPlayerMatchDataBatch(
        currentPuuid,
        matchesStart,
        5,
        1500
      );

      if (result.matches.length === 0) {
        setHasMoreMatches(false);
        setLoadingMore(false);
        return;
      }

      const impactCache = loadImpactCache();

      // Add new matches to cache
      result.matches.forEach((m) => {
        const category = classifyMatch(m);
        if (!impactCache[m.id]) {
          impactCache[m.id] = category;
        }
      });

      saveImpactCache(impactCache);

      // Calculate counts for ALL displayed matches (previous + new)
      const allDisplayedMatches = [...matchesData, ...result.matches];
      const newCounts: ImpactCounts = {
        impactWins: 0,
        impactLosses: 0,
        guaranteedWins: 0,
        guaranteedLosses: 0,
      };
      allDisplayedMatches.forEach((m) => {
        const category = classifyMatch(m);
        newCounts[category]++;
      });

      // Calculate lifetime counts from entire cache
      const newLifetime: ImpactCounts = {
        impactWins: 0,
        impactLosses: 0,
        guaranteedWins: 0,
        guaranteedLosses: 0,
      };
      Object.values(impactCache).forEach((cat) => {
        newLifetime[cat]++;
      });

      setLifetimeCounts(newLifetime);
      setImpactCounts(newCounts);
      setMatchesData(allDisplayedMatches);
      setHasMoreMatches(result.hasMore);
      setMatchesStart(result.nextStart);
      setRateLimitStatus({ remaining: rateLimiter.getStatus().remaining, resetAt: rateLimiter.getStatus().resetAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more matches");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Update rate limit status periodically
  useEffect(() => {
    if (!hasSearched) return;

    const updateRateLimitStatus = () => {
      const status = rateLimiter.getStatus();
      setRateLimitStatus({ remaining: status.remaining, resetAt: status.resetAt });
    };

    // Update immediately
    updateRateLimitStatus();

    // Update every second
    const interval = setInterval(updateRateLimitStatus, 1000);

    return () => clearInterval(interval);
  }, [hasSearched]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-purple-900 to-blue-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-white">League of Legends Match History</h1>
          <p className="text-blue-200">Performance Timeline & Impact Analysis</p>
        </div>

        {/* Search Form */}
        <Card className="bg-slate-800/50 border-slate-600/50">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-white">Enter Summoner Information</CardTitle>
                <CardDescription className="text-slate-300">
                  Enter your Riot ID to analyze your recent ranked matches
                </CardDescription>
              </div>
              {rateLimitStatus && (
                <div className="text-right">
                  <div className={cn(
                    "text-sm font-medium",
                    rateLimitStatus.remaining < 10 ? "text-yellow-400" : "text-slate-400"
                  )}>
                    {rateLimitStatus.remaining} requests left
                  </div>
                  {rateLimitStatus.remaining < 10 && (
                    <div className="text-xs text-slate-500 mt-1">
                      Resets in {Math.ceil((rateLimitStatus.resetAt - Date.now()) / 1000)}s
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <Label htmlFor="gameName" className="text-white">Riot User</Label>
                <Input
                  id="gameName"
                  value={gameName}
                  onChange={(e) => setGameName(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Riot User"
                  className="bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                />
              </div>
              <div className="flex items-center justify-center pb-2">
                <span className="text-white text-xl font-semibold">#</span>
              </div>
              <div className="flex-1">
                <Label htmlFor="tagLine" className="text-white">Tag Line</Label>
                <Input
                  id="tagLine"
                  value={tagLine}
                  onChange={(e) => setTagLine(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Enter tag line (e.g., NA1)"
                  className="bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                />
              </div>
              <Button
                onClick={handleSearch}
                disabled={loading || !gameName || !tagLine}
                className="px-8"
              >
                {loading ? "Loading..." : "Analyze"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Error Display */}
        {error && (
          <Alert className="bg-red-900/50 border-red-600">
            <AlertDescription className="text-red-200">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {loading && (
          <Card className="bg-slate-800/50 border-slate-600/50">
            <CardContent className="p-8 text-center">
              <div className="text-white text-lg">Analyzing matches...</div>
              <div className="text-slate-300 text-sm mt-2">This may take a few moments</div>
            </CardContent>
          </Card>
        )}

        {/* Match List */}
        {hasSearched && !loading && matchesData.length > 0 && (
          <div className="flex flex-col md:flex-row gap-6">
            {/* Match cards */}
            <div className="md:w-3/5 space-y-6">
              {matchesData.map((match) => (
                <Card key={match.id} className="bg-slate-800/50 border-slate-600/50 w-full">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-white flex items-center gap-3">
                          {match.champion}
                          <Badge
                            variant={match.gameResult === "Victory" ? "default" : "destructive"}
                            className={match.gameResult === "Victory" ? "bg-green-600 text-white hover:bg-green-600" : ""}
                          >
                            {match.gameResult}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="text-slate-300 mt-1">
                          {match.summonerName} ⏱️ {match.gameTime} ⚔️ {match.kda}  <br />
                          🧙 {match.cs} 🔎 {match.visionScore}
                        </CardDescription>
                      </div>
                      <div className="text-right space-y-1">
                        <div className="text-slate-300 text-sm">
                          Your Average Score: {match.yourImpact.toFixed(2)} <br />
                          Average Teammate Score: { match.teamImpact.toFixed(2) }
                        </div>
                        <div className="text-slate-400 text-xs">
                          {match.rank}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="text-slate-300 text-sm font-medium">Performance Timeline</div>
                      <MatchChart data={match.data} />
                    </div>
                  </CardContent>
                </Card>
              ))}
              
              {/* Load More Button */}
              {hasMoreMatches && (
                <div className="flex flex-col items-center gap-4 pt-4">
                  {rateLimitStatus && rateLimitStatus.remaining < 10 && (
                    <Alert className="bg-yellow-900/50 border-yellow-600 max-w-md">
                      <AlertDescription className="text-yellow-200 text-sm">
                        Rate limit warning: {rateLimitStatus.remaining} requests remaining
                      </AlertDescription>
                    </Alert>
                  )}
                  <Button
                    onClick={handleLoadMore}
                    disabled={loadingMore || !hasMoreMatches}
                    className="px-8"
                  >
                    {loadingMore ? "Loading more matches..." : "Load More Matches"}
                  </Button>
                  {loadingMore && (
                    <div className="text-slate-300 text-sm">Processing matches, please wait...</div>
                  )}
                </div>
              )}
            </div>

            {/* Right side sticky stats */}
            <div className="md:flex-1 space-y-6">
              {/* Impact Overview */}
              <Card className="bg-slate-800/50 border-slate-600/50 h-[450px] flex flex-col sticky top-6">
                <CardHeader>
                  <CardTitle className="text-white">Impact Overview</CardTitle>
                  <CardDescription className="text-slate-300">Last {matchesData.length} matches</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex items-center justify-center">
                  <ImpactPieChart counts={impactCounts} />
                </CardContent>
              </Card>

              {/* Lifetime Stats */}
              <Card className="bg-slate-800/50 border-slate-600/50 flex flex-col sticky top-[520px]">
                <CardHeader>
                  <CardTitle className="text-white">Lifetime Stats</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pb-6">
                  {/* Luck Line */}
                  {(() => {
                    const totalGuaranteed = lifetimeCounts.guaranteedWins + lifetimeCounts.guaranteedLosses;
                    const luckPct = totalGuaranteed === 0 ? 50 : Math.round((lifetimeCounts.guaranteedWins / totalGuaranteed) * 100);
                    const luckColor = luckPct >= 50 ? "text-green-400" : "text-red-400";
                    return (
                      <div className={cn("text-lg font-semibold", luckColor)}>
                        LUCK: {luckPct}%
                      </div>
                    );
                  })()}

                  {/* Stats breakdown */}
                  <div className="grid grid-cols-2 gap-2 text-slate-300 text-sm">
                    <div>Impact Wins:</div>
                    <div className="text-right font-medium text-green-400">{lifetimeCounts.impactWins}</div>
                    <div>Guaranteed Wins:</div>
                    <div className="text-right font-medium text-blue-400">{lifetimeCounts.guaranteedWins}</div>
                    <div>Impact Losses:</div>
                    <div className="text-right font-medium text-red-400">{lifetimeCounts.impactLosses}</div>
                    <div>Guaranteed Losses:</div>
                    <div className="text-right font-medium text-yellow-400">{lifetimeCounts.guaranteedLosses}</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* No Data State */}
        {hasSearched && !loading && matchesData.length === 0 && !error && (
          <Card className="bg-slate-800/50 border-slate-600/50">
            <CardContent className="p-8 text-center">
              <div className="text-slate-300 text-lg">No match data found</div>
              <div className="text-slate-400 text-sm mt-2">Try a different summoner name or check your spelling</div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
