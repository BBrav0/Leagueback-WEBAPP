"use client"

import { useState, useEffect, useRef, useCallback, memo, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
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
import type { MatchDetailsData, MatchDetailsParticipantSummary, MatchDetailsTeamSummary } from "@/lib/bridge"
import {
  deriveImpactCountsFromMatches,
  type ImpactCategory,
  type ImpactCounts,
} from "@/lib/impact-stats"
import { saveSuccessfulLookup, subscribeToSavedLookups, type SavedLookup } from "@/lib/saved-lookups"
import {
  countActiveHistoryFilters,
  DEFAULT_HISTORY_PREFERENCES,
  filterAndSortMatches,
  hasStoredHistoryPreferences,
  loadHistoryPreferences,
  resetHistoryPreferences,
  saveHistoryPreferences,
  type HistoryPreferences,
} from "@/lib/history-preferences"
import {
  buildHistoryExportFileName,
  createLoadedHistoryExportRows,
  serializeHistoryExportRowsToCsv,
} from "@/lib/history-export"
import {
  isValidationFixtureIdentity,
  VALIDATION_FIXTURE_ACCOUNT,
  VALIDATION_FIXTURE_DETAILS,
  VALIDATION_FIXTURE_IMPACT_COUNTS,
  VALIDATION_FIXTURE_MIXED_IMPACT_COUNTS,
} from "@/lib/validation-fixture"
import { cn } from "@/lib/utils"
import { rateLimiter } from "@/lib/rate-limiter"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"


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

const impactBadgeStyles: Record<ImpactCategory, string> = {
  impactWins: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
  impactLosses: "bg-rose-500/15 text-rose-200 border-rose-400/40",
  guaranteedWins: "bg-sky-500/15 text-sky-200 border-sky-400/40",
  guaranteedLosses: "bg-amber-500/15 text-amber-100 border-amber-400/40",
};

function formatDurationLabel(durationSeconds: number): string {
  const safeDuration = Math.max(durationSeconds, 0);
  const minutes = Math.floor(safeDuration / 60);
  const seconds = safeDuration % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function mergeMatchesInLoadedOrder(existing: MatchSummary[], incoming: MatchSummary[]): MatchSummary[] {
  const merged = [...existing];
  const seen = new Set(existing.map((match) => match.id));

  for (const match of incoming) {
    if (seen.has(match.id)) {
      continue;
    }

    seen.add(match.id);
    merged.push(match);
  }

  return merged;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePlayerFromUrl(pathname: string, hash: string): { gameName: string; tagLine: string } {
  const trimmedPath = pathname.replace(/^\/+|\/+$/g, "");
  const pathSegments = trimmedPath.split("/").filter(Boolean);
  const isPlayerRoute = pathSegments.length >= 2 && pathSegments[0].toLowerCase() === "player";
  const routeGameName = isPlayerRoute ? pathSegments[1] : "";
  const rawHash = hash.startsWith("#") ? hash.slice(1) : hash;

  return {
    gameName: routeGameName ? safeDecodeURIComponent(routeGameName) : "",
    tagLine: rawHash ? safeDecodeURIComponent(rawHash) : "",
  };
}

/**
 * Single module-level element so Recharts `content` prop keeps a stable reference.
 * Safe only while ChartTooltipContent stays stateless; if it later needs context
 * (theme, locale), switch to a tiny wrapper component or useMemo inside ImpactPieChart.
 */
const pieTooltipContent = <ChartTooltipContent hideLabel nameKey="name" />

function impactCountsEqual(a: ImpactCounts, b: ImpactCounts): boolean {
  return (
    a.impactWins === b.impactWins &&
    a.impactLosses === b.impactLosses &&
    a.guaranteedWins === b.guaranteedWins &&
    a.guaranteedLosses === b.guaranteedLosses
  );
}

const ImpactPieChart = memo(function ImpactPieChart({ counts }: { counts: ImpactCounts }) {
  const pieData = useMemo(
    (): { name: keyof typeof pieConfig; value: number }[] => [
      { name: "impactWins", value: counts.impactWins },
      { name: "impactLosses", value: counts.impactLosses },
      { name: "guaranteedWins", value: counts.guaranteedWins },
      { name: "guaranteedLosses", value: counts.guaranteedLosses },
    ],
    [counts.impactWins, counts.impactLosses, counts.guaranteedWins, counts.guaranteedLosses]
  );

  const total = useMemo(
    () => pieData.reduce((acc, cur) => acc + cur.value, 0),
    [pieData]
  );

  // Stable formatter: keeps slice % labels without recharts animation cost (isAnimationActive={false}).
  const renderSliceLabel = useCallback(
    ({ name, value }: { name?: string; value?: number }) => {
      const pct = total > 0 ? ((value ?? 0) / total) * 100 : 0;
      const config = pieConfig[(name ?? "") as keyof typeof pieConfig];
      if (!config) return `${value ?? 0}`;
      return `${config.label} ${pct.toFixed(0)}%`;
    },
    [total]
  );

  if (total === 0) {
    return (
      <div className="flex h-[300px] w-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-slate-400 text-sm">No categorized matches are loaded yet.</p>
        <p className="text-slate-500 text-xs max-w-xs">
          This chart updates after Leagueback loads analyzed matches from stored history or the Riot sync flow.
        </p>
      </div>
    );
  }

  return (
    <ChartContainer
      config={pieConfig}
      className="h-[300px] w-full justify-center [&_.recharts-responsive-container]:max-h-[300px]"
    >
      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
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
          isAnimationActive={false}
          label={renderSliceLabel}
          labelLine={false}
        >
          {pieData.map((entry) => (
            <Cell
              key={`cell-${entry.name}`}
              fill={pieConfig[entry.name as keyof typeof pieConfig].color}
            />
          ))}
        </Pie>
        <ChartTooltip content={pieTooltipContent} />
        <ChartLegend content={<ChartLegendContent />} />
      </PieChart>
    </ChartContainer>
  );
}, (prev, next) => impactCountsEqual(prev.counts, next.counts));

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

const teamCardStyles: Record<MatchDetailsTeamSummary["result"], string> = {
  Victory: "border-emerald-500/40 bg-emerald-500/10",
  Defeat: "border-rose-500/40 bg-rose-500/10",
  Unknown: "border-slate-600/60 bg-slate-900/40",
};

function MatchDetailsLoadingState() {
  return (
    <div className="space-y-4 rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-40 bg-slate-700/70" />
        <Skeleton className="h-4 w-24 bg-slate-700/60" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, teamIndex) => (
          <div
            key={`team-skeleton-${teamIndex}`}
            className="space-y-3 rounded-lg border border-slate-700/60 bg-slate-800/50 p-4"
          >
            <Skeleton className="h-5 w-32 bg-slate-700/60" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((__, rowIndex) => (
                <Skeleton
                  key={`participant-skeleton-${teamIndex}-${rowIndex}`}
                  className="h-14 w-full bg-slate-700/50"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchDetailsFallback({ details }: { details: MatchDetailsData }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
      <div className="font-medium text-amber-50">Match details unavailable</div>
      <p className="mt-2">{details.statusLabel}</p>
    </div>
  );
}

function ParticipantRow({ participant }: { participant: MatchDetailsParticipantSummary }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3",
        participant.isCurrentPlayer
          ? "border-sky-400/60 bg-sky-500/10 ring-1 ring-sky-300/30"
          : "border-slate-700/70 bg-slate-900/50"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-white">{participant.summonerName}</span>
            {participant.isCurrentPlayer && (
              <Badge className="bg-sky-500/20 text-sky-100 hover:bg-sky-500/20">
                You
              </Badge>
            )}
            {participant.isMissingCoreData && (
              <Badge variant="outline" className="border-amber-400/40 text-amber-100">
                Partial data
              </Badge>
            )}
          </div>
          <div className="text-xs text-slate-300">
            {participant.championName} • {participant.roleLabel}
          </div>
        </div>
        <div className="text-right text-xs text-slate-300">
          <div>{participant.kdaLabel}</div>
          <div>{participant.visionScoreLabel}</div>
        </div>
      </div>
      <div className="mt-2 text-xs text-slate-400">{participant.damageToChampionsLabel}</div>
    </div>
  );
}

function MatchDetailsContent({ details }: { details: MatchDetailsData }) {
  if (details.status === "unavailable") {
    return <MatchDetailsFallback details={details} />;
  }

  const sourceLabel =
    details.source === "match_cache"
      ? "Cached match data"
      : details.source === "legacy_cache"
        ? "Legacy cached match data"
        : null;

  const participantsByTeam = details.teams.map((team) => ({
    team,
    participants: details.participants.filter((participant) => participant.teamId === team.teamId),
  }));

  return (
    <div className="space-y-4 rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-white">Match details</div>
          <div className="text-xs text-slate-400">{details.statusLabel}</div>
        </div>
        {sourceLabel ? (
          <Badge variant="outline" className="border-slate-600 text-slate-200">
            {sourceLabel}
          </Badge>
        ) : null}
      </div>
      <Separator className="bg-slate-700/60" />
      <div className="grid gap-4 xl:grid-cols-2">
        {participantsByTeam.map(({ team, participants }) => (
          <div
            key={team.teamId}
            className={cn("rounded-lg border p-4", teamCardStyles[team.result])}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-white">
                Team {team.teamId === 100 ? "Blue" : team.teamId === 200 ? "Red" : team.teamId}
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  team.result === "Victory"
                    ? "border-emerald-300/50 text-emerald-100"
                    : team.result === "Defeat"
                      ? "border-rose-300/50 text-rose-100"
                      : "border-slate-500/60 text-slate-200"
                )}
              >
                {team.resultLabel}
              </Badge>
            </div>
            <div className="space-y-3">
              {participants.map((participant) => (
                <ParticipantRow
                  key={`${participant.teamId}-${participant.participantId}`}
                  participant={participant}
                />
              ))}
              {participants.length === 0 && (
                <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-4 text-sm text-slate-300">
                  Team participant details are unavailable for this side of the match.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const MatchCard = memo(function MatchCard({
  match,
  currentPuuid,
  compactCards = false,
  fixtureDetailsByMatchId,
}: {
  match: MatchSummary;
  currentPuuid: string | null;
  compactCards?: boolean;
  fixtureDetailsByMatchId?: Record<string, MatchDetailsData>;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [showChart, setShowChart] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsData, setDetailsData] = useState<MatchDetailsData | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || showChart) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShowChart(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [showChart]);

  const handleToggleDetails = useCallback(async () => {
    if (isDetailsOpen) {
      setIsDetailsOpen(false);
      return;
    }

    setIsDetailsOpen(true);

    if (detailsData || detailsLoading || !currentPuuid) {
      return;
    }

    setDetailsLoading(true);
    setDetailsError(null);

    try {
      if (fixtureDetailsByMatchId?.[match.id]) {
        setDetailsData(fixtureDetailsByMatchId[match.id]);
        return;
      }

      const response = await BackendBridge.getMatchDetails(match.id, currentPuuid);
      if (!response) {
        throw new Error("Leagueback could not load details for this match.");
      }

      setDetailsData(response.details);
    } catch (error) {
      setDetailsError(
        error instanceof Error ? error.message : "Leagueback could not load details for this match."
      );
    } finally {
      setDetailsLoading(false);
    }
  }, [currentPuuid, detailsData, detailsLoading, fixtureDetailsByMatchId, isDetailsOpen, match.id]);

  return (
    <div ref={cardRef}>
      <Card className="bg-slate-800/50 border-slate-600/50 w-full">
        <CardHeader className={cn(compactCards ? "pb-4" : undefined)}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <CardTitle className="text-white flex flex-wrap items-center gap-3">
                {match.champion}
                <Badge
                  variant={match.gameResult === "Victory" ? "default" : "destructive"}
                  className={match.gameResult === "Victory" ? "bg-green-600 text-white hover:bg-green-600" : ""}
                >
                  {match.gameResult}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn("border", impactBadgeStyles[match.impactCategory])}
                >
                  {match.impactCategoryLabel}
                </Badge>
              </CardTitle>
              <CardDescription className={cn("text-slate-300", compactCards ? "text-xs" : undefined)}>
                {match.summonerName} ⏱️ {match.gameTime} ⚔️ {match.kda}  <br />
                🧙 {match.cs} 🔎 {match.visionScore}
              </CardDescription>
              <div className={cn("flex flex-wrap gap-2 text-xs text-slate-200", compactCards ? "gap-1.5" : undefined)}>
                <Badge variant="secondary" className="bg-slate-700/70 text-slate-100 hover:bg-slate-700/70">
                  Played {match.playedAt}
                </Badge>
                <Badge variant="secondary" className="bg-slate-700/70 text-slate-100 hover:bg-slate-700/70">
                  Duration {formatDurationLabel(match.durationSeconds)}
                </Badge>
                <Badge variant="secondary" className="bg-slate-700/70 text-slate-100 hover:bg-slate-700/70">
                  {match.roleLabel}
                </Badge>
                <Badge variant="secondary" className="bg-slate-700/70 text-slate-100 hover:bg-slate-700/70">
                  {match.damageToChampionsLabel}
                </Badge>
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="text-slate-300 text-sm">
                Your Average Score: {match.yourImpact.toFixed(2)} <br />
                Average Teammate Score: { match.teamImpact.toFixed(2) }
              </div>
              <div className="text-slate-400 text-xs">
                {match.rankLabel}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn(compactCards ? "pt-0" : undefined)}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-slate-300 text-sm font-medium">Performance Timeline</div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleToggleDetails()}
                className="border-slate-600 bg-slate-900/60 text-slate-100 hover:bg-slate-700 hover:text-white"
              >
                {isDetailsOpen ? "Hide match details" : "View match details"}
              </Button>
            </div>
            {showChart ? (
              <MatchChart data={match.data} />
            ) : (
              <div className="h-[250px] w-full animate-pulse rounded-md bg-slate-700/50" />
            )}
            {isDetailsOpen && (
              detailsLoading ? (
                <MatchDetailsLoadingState />
              ) : detailsError ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                  {detailsError}
                </div>
              ) : detailsData ? (
                <MatchDetailsContent details={detailsData} />
              ) : null
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

export default function Component() {
  const router = useRouter();
  const pathname = usePathname();
  const [matchesData, setMatchesData] = useState<MatchSummary[]>([]);
  const [savedLookups, setSavedLookups] = useState<SavedLookup[]>([]);
  const [historyPreferences, setHistoryPreferences] = useState<HistoryPreferences>(DEFAULT_HISTORY_PREFERENCES);
  const [impactCounts, setImpactCounts] = useState<ImpactCounts>({
    impactWins: 0,
    impactLosses: 0,
    guaranteedWins: 0,
    guaranteedLosses: 0,
  });
  const [lifetimeCounts, setLifetimeCounts] = useState<ImpactCounts>({
    impactWins: 0,
    impactLosses: 0,
    guaranteedWins: 0,
    guaranteedLosses: 0,
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
  const [totalDbMatches, setTotalDbMatches] = useState(0);
  const [loadedDbMatches, setLoadedDbMatches] = useState(0);
  const [hasMoreDbMatches, setHasMoreDbMatches] = useState(false);
  const [allDbMatchesLoaded, setAllDbMatchesLoaded] = useState(false);
  const [loadingDbMatches, setLoadingDbMatches] = useState(false);
  const [fetchingMatchesFromApi, setFetchingMatchesFromApi] = useState(false);
  const [isValidationFixtureActive, setIsValidationFixtureActive] = useState(false);
  const didHydrateHistoryPreferencesRef = useRef(false);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const autoSearchKeyRef = useRef<string | null>(null);
  const matchesDataRef = useRef<MatchSummary[]>([]);
  const pageScrollLockYRef = useRef<number | null>(null);
  const loadingPlaceholderCount = loadingDbMatches ? 3 : loadingMore ? 2 : 0;

  useEffect(() => {
    matchesDataRef.current = matchesData;
  }, [matchesData]);

  useEffect(() => {
    setHistoryPreferences(loadHistoryPreferences());
    didHydrateHistoryPreferencesRef.current = true;
  }, []);

  useEffect(() => {
    return subscribeToSavedLookups(setSavedLookups);
  }, []);

  useEffect(() => {
    if (!didHydrateHistoryPreferencesRef.current && !hasStoredHistoryPreferences()) {
      return;
    }

    saveHistoryPreferences(historyPreferences);
  }, [historyPreferences]);

  const filteredMatches = useMemo(
    () => filterAndSortMatches(matchesData, historyPreferences),
    [historyPreferences, matchesData]
  );

  const activeHistoryFilterCount = useMemo(
    () => countActiveHistoryFilters(historyPreferences),
    [historyPreferences]
  );

  const exportRows = useMemo(
    () => createLoadedHistoryExportRows(filteredMatches),
    [filteredMatches]
  );

  const canExportLoadedHistory = exportRows.length > 0;

  const championFilterOptions = useMemo(() => {
    return Array.from(new Set(matchesData.map((match) => match.champion).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [matchesData]);

  const syncImpactStats = useCallback(async (puuid: string, matches: MatchSummary[]) => {
    try {
      const [lifetimeRes, pieRes] = await Promise.all([
        fetch(`/api/impact-categories?puuid=${encodeURIComponent(puuid)}`),
        fetch(`/api/impact-categories?puuid=${encodeURIComponent(puuid)}&limit=10`),
      ]);

      let lifetimeDbSucceeded = false;
      let lifetimeCategoryCount = 0;

      if (lifetimeRes.ok) {
        const lifetimeData = await lifetimeRes.json();
        if (!lifetimeData.error) {
          lifetimeDbSucceeded = true;
          const counts: ImpactCounts = { impactWins: 0, impactLosses: 0, guaranteedWins: 0, guaranteedLosses: 0 };
          (lifetimeData.categories || []).forEach((cat: string) => {
            if (cat in counts) counts[cat as keyof ImpactCounts]++;
          });
          lifetimeCategoryCount = (lifetimeData.categories || []).length;
          setLifetimeCounts(counts);
        }
      }

      if (pieRes.ok) {
        const pieData = await pieRes.json();
        if (!pieData.error) {
          const counts: ImpactCounts = { impactWins: 0, impactLosses: 0, guaranteedWins: 0, guaranteedLosses: 0 };
          (pieData.categories || []).forEach((cat: string) => {
            if (cat in counts) counts[cat as keyof ImpactCounts]++;
          });
          setImpactCounts(counts);
        }
      }

      // Client fallback only when the lifetime API responded successfully with zero categories — not on network/5xx errors.
      if (lifetimeDbSucceeded && lifetimeCategoryCount === 0 && matches.length > 0) {
        const { pie, lifetime } = deriveImpactCountsFromMatches(matches);
        setImpactCounts(pie);
        setLifetimeCounts(lifetime);
      }
    } catch (error) {
      console.error("Error updating stats from database:", error);
    }
  }, []);

  const runSearch = useCallback(async (
    rawGameName: string,
    rawTagLine: string,
    options?: { syncUrl?: boolean }
  ) => {
    const normalizedGameName = rawGameName.trim();
    const normalizedTagLine = rawTagLine.trim();

    if (!normalizedGameName || !normalizedTagLine) {
      setError("Enter both parts of the Riot ID before searching.");
      return;
    }

    if (isValidationFixtureIdentity(normalizedGameName, normalizedTagLine)) {
      if (options?.syncUrl !== false) {
        const nextUrl = `/player/${encodeURIComponent(VALIDATION_FIXTURE_ACCOUNT.gameName)}#${encodeURIComponent(VALIDATION_FIXTURE_ACCOUNT.tagLine)}`;
        if (typeof window !== "undefined") {
          const currentUrl = `${window.location.pathname}${window.location.hash}`;
          if (currentUrl !== nextUrl) {
            autoSearchKeyRef.current = `${VALIDATION_FIXTURE_ACCOUNT.gameName}#${VALIDATION_FIXTURE_ACCOUNT.tagLine}`;
            router.push(nextUrl);
          }
        }
      }

      setGameName(VALIDATION_FIXTURE_ACCOUNT.gameName);
      setTagLine(VALIDATION_FIXTURE_ACCOUNT.tagLine);
      setLoading(false);
      setLoadingMore(false);
      setLoadingDbMatches(false);
      setFetchingMatchesFromApi(false);
    }

    const routeKey = `${normalizedGameName}#${normalizedTagLine}`;
    if (options?.syncUrl !== false) {
      autoSearchKeyRef.current = routeKey;
      const nextUrl = `/player/${encodeURIComponent(normalizedGameName)}#${encodeURIComponent(normalizedTagLine)}`;
      if (typeof window !== "undefined") {
        const currentUrl = `${window.location.pathname}${window.location.hash}`;
        if (currentUrl !== nextUrl) {
          router.push(nextUrl);
        }
      }
    }

    // Keep input state normalized to the routed identity.
    setGameName(normalizedGameName);
    setTagLine(normalizedTagLine);

    // Check rate limit before starting (don't count — search only hits DB)
    const rateLimitCheck = rateLimiter.getStatus();
    if (!rateLimitCheck.allowed) {
      setError(`Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds.`);
      return;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setIsValidationFixtureActive(false);
    setFetchingMatchesFromApi(false);
    setMatchesData([]);
    setCurrentPuuid(null);
    setImpactCounts({
      impactWins: 0,
      impactLosses: 0,
      guaranteedWins: 0,
      guaranteedLosses: 0,
    });
    setLifetimeCounts({
      impactWins: 0,
      impactLosses: 0,
      guaranteedWins: 0,
      guaranteedLosses: 0,
    });
    setMatchesStart(0);
    setHasMoreMatches(false);
    setTotalDbMatches(0);
    setLoadedDbMatches(0);
    setHasMoreDbMatches(false);
    setAllDbMatchesLoaded(false);

    let loadingDismissedEarly = false;
    try {
      const account = await BackendBridge.getAccount(normalizedGameName, normalizedTagLine);
      if (!account) {
        throw new Error("Failed to get account information");
      }

      setSavedLookups(
        saveSuccessfulLookup({
          gameName: normalizedGameName,
          tagLine: normalizedTagLine,
        })
      );
      setCurrentPuuid(account.puuid);
      setIsValidationFixtureActive(account.puuid === VALIDATION_FIXTURE_ACCOUNT.puuid);

      // Fetch first page of stored matches from DB
      const storedResult = await BackendBridge.getStoredMatches(account.puuid, 20, 0);

      setMatchesData(storedResult.matches);
      setTotalDbMatches(storedResult.totalCount);
      setLoadedDbMatches(storedResult.matches.length);
      setHasMoreDbMatches(storedResult.hasMore);

      let apiHasMore = false;
      if (!storedResult.hasMore) {
        // All DB matches fit on first page (or there are none)
        setAllDbMatchesLoaded(true);
        apiHasMore = await BackendBridge.checkApiHasMore(
          account.puuid,
          storedResult.totalCount
        );
        setHasMoreMatches(apiHasMore);
        setMatchesStart(storedResult.totalCount);
      }

      let matchesForStats = storedResult.matches;

      if (account.puuid === VALIDATION_FIXTURE_ACCOUNT.puuid) {
        setImpactCounts(VALIDATION_FIXTURE_IMPACT_COUNTS.pie);
        setLifetimeCounts(VALIDATION_FIXTURE_MIXED_IMPACT_COUNTS.lifetime);
      }

      // Dismiss full-screen "Analyzing" as soon as account + first DB page are known.
      // Riot backfill (if any) is indicated by `fetchingMatchesFromApi` so we avoid
      // a long blocking spinner without hiding ongoing work.
      setLoading(false);
      loadingDismissedEarly = true;

      // Returning players: Riot may have newer games than DB head; sync only the new prefix (see BackendBridge.syncNewHeadMatchesFromRiot).
      if (storedResult.totalCount > 0) {
        const syncRate = rateLimiter.checkRateLimit();
        if (syncRate.allowed) {
          setFetchingMatchesFromApi(true);
          try {
            const syncResult = await BackendBridge.syncNewHeadMatchesFromRiot(
              account.puuid,
              storedResult.totalCount,
              { windowSize: 25, analyzeDelayMs: 1500, maxSyncRounds: 12 }
            );
            if (
              !syncResult.skippedAlreadyFresh &&
              !syncResult.skippedNoHistory &&
              syncResult.analyzedCount === 0 &&
              syncResult.failedAnalyzeAttempts > 0
            ) {
              setError(
                "We could not save new match results. Please try again later."
              );
              if (process.env.NODE_ENV === "development") {
                console.warn(
                  "[head-sync] All analyze attempts failed to persist (common fix: set SUPABASE_SERVICE_ROLE_KEY in .env.local for server routes; check terminal for player_matches upsert errors)."
                );
              }
            }
            if (syncResult.analyzedCount > 0) {
              const refreshed = await BackendBridge.getStoredMatches(account.puuid, 20, 0);
              setMatchesData(refreshed.matches);
              setTotalDbMatches(refreshed.totalCount);
              setLoadedDbMatches(refreshed.matches.length);
              setHasMoreDbMatches(refreshed.hasMore);
              matchesForStats = refreshed.matches;

              if (!refreshed.hasMore) {
                setAllDbMatchesLoaded(true);
                const more = await BackendBridge.checkApiHasMore(
                  account.puuid,
                  refreshed.totalCount
                );
                setHasMoreMatches(more);
                setMatchesStart(refreshed.totalCount);
              } else {
                setAllDbMatchesLoaded(false);
              }
            }
          } finally {
            setFetchingMatchesFromApi(false);
          }
        }
      }

      // If user exists but DB has no categorized matches, auto-fetch first 10 from API
      if (storedResult.totalCount === 0 && apiHasMore) {
        const rateLimitCheck = rateLimiter.checkRateLimit();
        if (!rateLimitCheck.allowed) {
          setError(`Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds.`);
          // No batch run — matchesForStats stays []. syncImpactStats still loads from DB below.
        } else {
          setFetchingMatchesFromApi(true);
          try {
            const result = await BackendBridge.getPlayerMatchDataBatch(
              account.puuid,
              0,
              10,
              1500
            );
            setMatchesData(result.matches);
            setTotalDbMatches(result.matches.length);
            setHasMoreMatches(result.hasMore);
            setMatchesStart(result.nextStart);
            matchesForStats = result.matches;
          } finally {
            setFetchingMatchesFromApi(false);
          }
        }
      }

      if (account.puuid !== VALIDATION_FIXTURE_ACCOUNT.puuid) {
        await syncImpactStats(account.puuid, matchesForStats);
      }

      setRateLimitStatus({
        remaining: rateLimiter.getStatus().remaining,
        resetAt: rateLimiter.getStatus().resetAt,
      });

      if (storedResult.totalCount === 0 && !apiHasMore) {
        const apiCheck = await BackendBridge.checkApiHasMore(account.puuid, 0);
        if (!apiCheck) {
          setError("No ranked match history is available for this Riot ID yet.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Leagueback could not load this player's match history.");
      setMatchesData([]);
      setCurrentPuuid(null);
    } finally {
      setFetchingMatchesFromApi(false);
      if (!loadingDismissedEarly) {
        setLoading(false);
      }
    }
  }, [router, syncImpactStats]);

  const handleSearch = async () => {
    await runSearch(gameName, tagLine, { syncUrl: true });
  };

  const handleSavedLookupClick = async (lookup: SavedLookup) => {
    await runSearch(lookup.gameName, lookup.tagLine, { syncUrl: true });
  };

  const updateHistoryPreferences = useCallback(
    (updates: Partial<HistoryPreferences>) => {
      setHistoryPreferences((current) => ({
        ...current,
        ...updates,
      }));
    },
    []
  );

  const handleResetHistoryPreferences = useCallback(() => {
    setHistoryPreferences(resetHistoryPreferences());
  }, []);

  const handleExportLoadedHistory = useCallback(() => {
    if (!canExportLoadedHistory || typeof window === "undefined") {
      return;
    }

    const csv = serializeHistoryExportRowsToCsv(exportRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = buildHistoryExportFileName(gameName, tagLine);
    anchor.click();
    window.URL.revokeObjectURL(objectUrl);
  }, [canExportLoadedHistory, exportRows, gameName, tagLine]);

  const handleLoadMore = async () => {
    if (!currentPuuid || loadingMore || !allDbMatchesLoaded) return;

    // Check rate limit and COUNT this request (hits Riot API)
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

      const merged = mergeMatchesInLoadedOrder(matchesDataRef.current, result.matches);
      setMatchesData(merged);

      // Newly fetched matches are stored in DB by match-performance route
      setTotalDbMatches(prev => prev + result.matches.filter((match) =>
        !matchesDataRef.current.some((existing) => existing.id === match.id)
      ).length);

      if (currentPuuid === VALIDATION_FIXTURE_ACCOUNT.puuid) {
        setImpactCounts(deriveImpactCountsFromMatches(merged).pie);
        setLifetimeCounts(VALIDATION_FIXTURE_MIXED_IMPACT_COUNTS.lifetime);
      } else {
        await syncImpactStats(currentPuuid, merged);
      }

      // Check if API has more
      const apiHasMore = await BackendBridge.checkApiHasMore(currentPuuid, result.nextStart);
      setHasMoreMatches(apiHasMore);
      setMatchesStart(result.nextStart);

      setRateLimitStatus({
        remaining: rateLimiter.getStatus().remaining,
        resetAt: rateLimiter.getStatus().resetAt,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Leagueback could not load more older matches right now. Please try again in a moment."
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const { gameName: routeGameName, tagLine: routeTagLine } = parsePlayerFromUrl(pathname, window.location.hash);

    if (routeGameName) {
      setGameName(routeGameName);
    }

    if (routeTagLine) {
      setTagLine(routeTagLine);
    }

    if (!routeGameName || !routeTagLine) return;

    const routeKey = `${routeGameName}#${routeTagLine}`;
    if (autoSearchKeyRef.current === routeKey) return;

    autoSearchKeyRef.current = routeKey;
    void runSearch(routeGameName, routeTagLine, { syncUrl: false });
  }, [pathname, runSearch]);

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

  // Infinite scroll: load more DB matches when sentinel is visible
  const loadMoreDbMatches = useCallback(async () => {
    if (!currentPuuid || loadingDbMatches || !hasMoreDbMatches || allDbMatchesLoaded) return;

    setLoadingDbMatches(true);
    try {
      const result = await BackendBridge.getStoredMatches(currentPuuid, 20, loadedDbMatches);

      setMatchesData(prev => mergeMatchesInLoadedOrder(prev, result.matches));
      const uniqueIncomingCount = result.matches.filter((match) =>
        !matchesDataRef.current.some((existing) => existing.id === match.id)
      ).length;
      const newLoaded = loadedDbMatches + uniqueIncomingCount;
      setLoadedDbMatches(newLoaded);
      setHasMoreDbMatches(result.hasMore);

      if (!result.hasMore) {
        setAllDbMatchesLoaded(true);
        const apiHasMore = await BackendBridge.checkApiHasMore(currentPuuid, result.totalCount);
        setHasMoreMatches(apiHasMore);
        setMatchesStart(result.totalCount);
      }
    } catch (error) {
      console.error("Error loading more DB matches:", error);
    } finally {
      setLoadingDbMatches(false);
    }
  }, [currentPuuid, loadingDbMatches, hasMoreDbMatches, allDbMatchesLoaded, loadedDbMatches]);

  useEffect(() => {
    if (!hasSearched || allDbMatchesLoaded || !hasMoreDbMatches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreDbMatches();
        }
      },
      { threshold: 0.1 }
    );

    const el = scrollSentinelRef.current;
    if (el) observer.observe(el);

    return () => {
      if (el) observer.unobserve(el);
    };
  }, [hasSearched, allDbMatchesLoaded, hasMoreDbMatches, loadMoreDbMatches]);

  // Strong page-level bottom lock while additional matches are appending.
  // Prevents outrunning partially rendered cards on fast scroll/wheel/touch.
  useEffect(() => {
    const isAppendingMore = loadingDbMatches || loadingMore;
    if (!isAppendingMore) {
      pageScrollLockYRef.current = null;
      return;
    }

    const getMaxScrollY = () =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    if (pageScrollLockYRef.current === null) {
      pageScrollLockYRef.current = getMaxScrollY();
    }

    let rafId: number | null = null;
    const clampToLock = () => {
      const lockY = pageScrollLockYRef.current;
      if (lockY === null) return;
      if (window.scrollY > lockY) {
        window.scrollTo({ top: lockY, behavior: "auto" });
      }
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        clampToLock();
      });
    };

    const onWheel = (event: WheelEvent) => {
      const lockY = pageScrollLockYRef.current;
      if (lockY === null) return;
      // Block only downward movement once user reaches the current rendered bottom.
      if (event.deltaY > 0 && window.scrollY >= lockY - 1) {
        event.preventDefault();
        clampToLock();
      }
    };

    let touchStartY = 0;
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      const lockY = pageScrollLockYRef.current;
      if (lockY === null) return;
      const currentY = event.touches[0]?.clientY ?? touchStartY;
      const isDownwardPageMovement = touchStartY > currentY;
      if (isDownwardPageMovement && window.scrollY >= lockY - 1) {
        event.preventDefault();
        clampToLock();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, [loadingDbMatches, loadingMore]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-purple-900 to-blue-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-white">Leagueback web match history</h1>
          <p className="text-blue-200">Search a Riot ID to review ranked history, match details, and impact trends in your browser.</p>
        </div>

        {/* Search Form */}
        <Card className="bg-slate-800/50 border-slate-600/50">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-white">Search a Riot ID</CardTitle>
                <CardDescription className="text-slate-300">
                  Enter the game name and tag line for the player you want to review.
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
                <Label htmlFor="gameName" className="text-white">Game name</Label>
                <Input
                  id="gameName"
                  value={gameName}
                  onChange={(e) => setGameName(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Enter game name"
                  className="bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                />
              </div>
              <div className="flex items-center justify-center pb-2">
                <span className="text-white text-xl font-semibold">#</span>
              </div>
              <div className="flex-1">
                <Label htmlFor="tagLine" className="text-white">Tag line</Label>
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
                {loading ? "Loading player..." : "Search"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {savedLookups.length > 0 && (
          <Card className="bg-slate-800/50 border-slate-600/50">
            <CardHeader>
              <CardTitle className="text-white">Recent Riot IDs</CardTitle>
              <CardDescription className="text-slate-300">
                Successful lookups are saved on this device only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {savedLookups.map((lookup) => {
                  const key = `${lookup.gameName}#${lookup.tagLine}`;
                  return (
                    <Button
                      key={key}
                      type="button"
                      variant="outline"
                      onClick={() => void handleSavedLookupClick(lookup)}
                      className="border-slate-600 bg-slate-900/60 text-slate-100 hover:bg-slate-700 hover:text-white"
                    >
                      {lookup.gameName}
                      <span className="text-slate-400">#{lookup.tagLine}</span>
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {hasSearched && (
          <Card className="bg-slate-800/50 border-slate-600/50">
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-white">History filters & display</CardTitle>
                  <CardDescription className="text-slate-300">
                    Filter the matches currently loaded on this device and keep these preferences across refreshes.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="bg-slate-700/70 text-slate-100 hover:bg-slate-700/70">
                    Showing {filteredMatches.length} of {matchesData.length} loaded matches
                  </Badge>
                  <Badge variant="outline" className="border-emerald-400/40 text-emerald-100">
                    Export scope: {exportRows.length} filtered loaded match{exportRows.length === 1 ? "" : "es"}
                  </Badge>
                  {isValidationFixtureActive && allDbMatchesLoaded && hasMoreMatches && (
                    <Badge variant="outline" className="border-sky-400/40 text-sky-100">
                      Validation fixture older-history append ready
                    </Badge>
                  )}
                  {activeHistoryFilterCount > 0 && (
                    <Badge variant="outline" className="border-sky-400/40 text-sky-100">
                      {activeHistoryFilterCount} active filter{activeHistoryFilterCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-white">Result</Label>
                  <Select
                    value={historyPreferences.result}
                    onValueChange={(value) =>
                      updateHistoryPreferences({
                        result: value as HistoryPreferences["result"],
                      })
                    }
                  >
                    <SelectTrigger className="border-slate-600 bg-slate-900/60 text-slate-100">
                      <SelectValue placeholder="All results" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All results</SelectItem>
                      <SelectItem value="Victory">Victories</SelectItem>
                      <SelectItem value="Defeat">Defeats</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-white">Impact category</Label>
                  <Select
                    value={historyPreferences.impactCategory}
                    onValueChange={(value) =>
                      updateHistoryPreferences({
                        impactCategory: value as HistoryPreferences["impactCategory"],
                      })
                    }
                  >
                    <SelectTrigger className="border-slate-600 bg-slate-900/60 text-slate-100">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      <SelectItem value="impactWins">Impact wins</SelectItem>
                      <SelectItem value="impactLosses">Impact losses</SelectItem>
                      <SelectItem value="guaranteedWins">Guaranteed wins</SelectItem>
                      <SelectItem value="guaranteedLosses">Guaranteed losses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-white">Champion</Label>
                  <Select
                    value={historyPreferences.champion || "__all__"}
                    onValueChange={(value) =>
                      updateHistoryPreferences({
                        champion: value === "__all__" ? "" : value,
                      })
                    }
                  >
                    <SelectTrigger className="border-slate-600 bg-slate-900/60 text-slate-100">
                      <SelectValue placeholder="All champions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All champions</SelectItem>
                      {championFilterOptions.map((champion) => (
                        <SelectItem key={champion} value={champion}>
                          {champion}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
                <div className="space-y-2">
                  <Label className="text-white">Sort order</Label>
                  <Select
                    value={historyPreferences.sort}
                    onValueChange={(value) =>
                      updateHistoryPreferences({
                        sort: value as HistoryPreferences["sort"],
                      })
                    }
                  >
                    <SelectTrigger className="border-slate-600 bg-slate-900/60 text-slate-100">
                      <SelectValue placeholder="Newest first" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Loaded order</SelectItem>
                      <SelectItem value="highestImpact">Highest impact first</SelectItem>
                      <SelectItem value="oldest">Oldest loaded first</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-900/50 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-white">Compact cards</div>
                    <div className="text-xs text-slate-400">Persisted per device.</div>
                  </div>
                  <Switch
                    checked={historyPreferences.compactCards}
                    onCheckedChange={(checked) =>
                      updateHistoryPreferences({ compactCards: checked })
                    }
                    aria-label="Toggle compact cards"
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleExportLoadedHistory}
                  disabled={!canExportLoadedHistory}
                  className="bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400"
                >
                  Export filtered loaded history
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResetHistoryPreferences}
                  className="border-slate-600 bg-slate-900/60 text-slate-100 hover:bg-slate-700 hover:text-white"
                >
                  Reset saved filters
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error Display */}
        {error && (
          <Alert className="bg-red-900/50 border-red-600">
            <AlertDescription className="text-red-200">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {hasSearched && fetchingMatchesFromApi && (
          <Alert className="border-blue-600/50 bg-slate-800/50">
            <AlertDescription className="text-slate-200 text-sm">
              Leagueback is requesting additional match data from Riot. This can take about a minute.
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {loading && (
          <Card className="bg-slate-800/50 border-slate-600/50">
            <CardContent className="p-8 text-center">
              <div className="text-white text-lg">Loading player history…</div>
              <div className="text-slate-300 text-sm mt-2">Leagueback is loading the account and first match results for this Riot ID.</div>
            </CardContent>
          </Card>
        )}

        {/* Match List */}
        {hasSearched && !loading && matchesData.length > 0 && (
          <div className="flex flex-col md:flex-row gap-6">
            {/* Match cards */}
            <div className="md:w-3/5 space-y-6">
              {filteredMatches.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  currentPuuid={currentPuuid}
                  compactCards={historyPreferences.compactCards}
                  fixtureDetailsByMatchId={isValidationFixtureActive ? VALIDATION_FIXTURE_DETAILS : undefined}
                />
              ))}

              {filteredMatches.length === 0 && (
                <Card className="bg-slate-800/50 border-slate-600/50">
                  <CardContent className="p-8 text-center">
                    <div className="text-slate-200 text-lg">No loaded matches match these filters</div>
                    <div className="mt-2 text-sm text-slate-400">
                      Change the current result, impact category, or champion filters, or reset saved filters to show the full loaded history again.
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {/* Infinite scroll sentinel for DB matches */}
              {hasMoreDbMatches && !allDbMatchesLoaded && (
                <div ref={scrollSentinelRef} className="flex min-h-16 flex-col items-center justify-center py-4">
                  <div className="text-slate-400 text-sm">
                    {loadingDbMatches
                      ? "Loading another page of stored matches..."
                      : `Loaded ${loadedDbMatches} of ${totalDbMatches} stored matches`}
                  </div>
                </div>
              )}

              {loadingPlaceholderCount > 0 && (
                <div className="space-y-6" aria-hidden="true">
                  {Array.from({ length: loadingPlaceholderCount }).map((_, idx) => (
                    <Card
                      key={`loading-placeholder-${idx}`}
                      className="bg-slate-800/50 border-slate-600/50 w-full overflow-hidden"
                    >
                      <CardHeader className="animate-pulse space-y-3">
                        <div className="h-5 w-40 rounded bg-slate-700/70" />
                        <div className="h-4 w-56 rounded bg-slate-700/60" />
                      </CardHeader>
                      <CardContent className="animate-pulse">
                        <div className="space-y-4">
                          <div className="h-4 w-36 rounded bg-slate-700/60" />
                          <div className="h-[250px] w-full rounded-md bg-slate-700/50" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  <div className="flex min-h-12 items-center justify-center rounded-md border border-slate-700/60 bg-slate-800/40 px-4">
                    <div className="text-slate-300 text-sm">
                      Leagueback is rendering the next set of match cards before more scrolling is available.
                    </div>
                  </div>
                </div>
              )}

              {/* Load More Button — only after all DB matches are loaded */}
              {allDbMatchesLoaded && hasMoreMatches && (
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
                    {loadingMore ? "Loading more matches..." : "Load more matches from Riot"}
                  </Button>
                  {loadingMore && (
                    <div className="text-slate-300 text-sm">Analyzing the newly requested Riot matches before adding them to the dashboard.</div>
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
                  <CardDescription className="text-slate-300">
                    Last 10 matches
                  </CardDescription>
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
        {hasSearched && !loading && fetchingMatchesFromApi && matchesData.length === 0 && !error && (
          <Card className="bg-slate-800/50 border-slate-600/50">
            <CardContent className="p-8 flex flex-col items-center gap-4 animate-pulse">
              <div className="h-5 w-52 rounded-md bg-slate-700/80" />
              <div className="h-4 w-72 max-w-full rounded-md bg-slate-700/60" />
              <div className="h-10 w-40 rounded-md bg-slate-700/70 mt-2" />
            </CardContent>
          </Card>
        )}

        {/* No Data State */}
        {hasSearched && !loading && !fetchingMatchesFromApi && matchesData.length === 0 && !error && (
          <Card className="bg-slate-800/50 border-slate-600/50">
            <CardContent className="p-8 text-center flex flex-col items-center gap-4">
              <div className="text-slate-300 text-lg">No loaded match history is available yet</div>
              <div className="text-slate-400 text-sm">
                {hasMoreMatches
                  ? "Request matches from Riot to add the first set of loaded history for this player."
                  : "Check the Riot ID spelling or search for a different player."}
              </div>
              {allDbMatchesLoaded && hasMoreMatches && (
                <Button
                  onClick={handleLoadMore}
                  disabled={loadingMore || !hasMoreMatches}
                  className="px-8"
                >
                  {loadingMore ? "Loading more matches..." : "Load more matches from Riot"}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
