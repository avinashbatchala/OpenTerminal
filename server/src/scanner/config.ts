import { RECIPES, RECIPE_IDS } from "./recipes.js";
import type {
  Horizon,
  RecipeConfig,
  RecipeId,
  ScannerConfig,
  ScannerReadiness,
} from "./types.js";

const HORIZONS: Horizon[] = ["intraday", "swing"];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function defaultScannerConfig(): ScannerConfig {
  const recipes = {} as Record<RecipeId, RecipeConfig>;
  for (const id of RECIPE_IDS) {
    recipes[id] = {
      enabled: false,
      acceptedVersion: null,
      paramsApproved: false,
      params: Object.fromEntries(RECIPES[id].params.map((param) => [param.key, param.default])),
    };
  }

  return {
    enabled: false,
    revision: 0,
    watchlist: [],
    watchlistRevision: 0,
    fees: {
      currency: "USD",
      perOrderUsd: 0.65,
      entryPerContractUsd: 0.15,
      exitPerContractUsd: 0.15,
      expiryPerContractUsd: 0.15,
      confirmed: false,
    },
    horizons: {
      intraday: { minDays: 0, maxDays: 2, confirmed: false },
      swing: { minDays: 7, maxDays: 45, confirmed: false },
    },
    quotes: {
      maxUnderlyingAgeSeconds: 120,
      maxOptionAgeSeconds: 180,
      maxLegSkewSeconds: 90,
      maxBidAskWidthPct: 15,
      minVolume: 10,
      minOpenInterest: 100,
      confirmed: false,
    },
    selection: {
      maxStrikesPerSide: 30,
      targetStrikeDistancePct: 1.5,
      maxStrikeDistancePct: 10,
      minSpreadWidthPct: 1,
      maxSpreadWidthPct: 4,
      creditWingWidthPct: 1,
      slippagePct: 5,
      confirmed: false,
    },
    recipes,
    aiPricing: null,
    historyAssumptionAccepted: false,
    maxWatchlistSymbols: 25,
    scanIntervalMinutes: 5,
    updatedAt: null,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeHorizon(raw: unknown, fallback: ScannerConfig["horizons"][Horizon]) {
  const value = object(raw);
  return {
    minDays: Math.max(0, finite(value.minDays, fallback.minDays)),
    maxDays: Math.max(0, finite(value.maxDays, fallback.maxDays)),
    confirmed: bool(value.confirmed, fallback.confirmed),
  };
}

function normalizeRecipe(
  raw: unknown,
  fallback: RecipeConfig,
  id: RecipeId
): RecipeConfig {
  const value = object(raw);
  const paramsRaw = object(value.params);
  const params = Object.fromEntries(
    RECIPES[id].params.map((definition) => [
      definition.key,
      finite(paramsRaw[definition.key], fallback.params[definition.key] ?? definition.default),
    ])
  );
  return {
    enabled: bool(value.enabled, fallback.enabled),
    acceptedVersion: stringOrNull(value.acceptedVersion),
    paramsApproved: bool(value.paramsApproved, fallback.paramsApproved),
    params,
  };
}

/**
 * Treat incoming values as drafts, not approvals. Confirmation flags and
 * accepted versions must be explicitly present; they never default to true.
 */
export function normalizeScannerConfig(raw: unknown, fallback = defaultScannerConfig()): ScannerConfig {
  const value = object(raw);
  const fees = object(value.fees);
  const horizonsRaw = object(value.horizons);
  const quotes = object(value.quotes);
  const selection = object(value.selection);
  const recipesRaw = object(value.recipes);
  const aiPricingRaw = value.aiPricing;

  const recipes = {} as Record<RecipeId, RecipeConfig>;
  for (const id of RECIPE_IDS) {
    recipes[id] = normalizeRecipe(recipesRaw[id], fallback.recipes[id], id);
  }

  const aiPricing = aiPricingRaw
    ? {
        source: String(object(aiPricingRaw).source ?? "").trim().slice(0, 160),
        inputPerMillionUsd: Math.max(
          0,
          finite(object(aiPricingRaw).inputPerMillionUsd, 0)
        ),
        outputPerMillionUsd: Math.max(
          0,
          finite(object(aiPricingRaw).outputPerMillionUsd, 0)
        ),
        cacheReadPerMillionUsd: Math.max(
          0,
          finite(object(aiPricingRaw).cacheReadPerMillionUsd, 0)
        ),
        cacheWritePerMillionUsd: Math.max(
          0,
          finite(object(aiPricingRaw).cacheWritePerMillionUsd, 0)
        ),
      }
    : null;

  const watchlist = Array.isArray(value.watchlist)
    ? Array.from(
        new Set(
          value.watchlist
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim().toUpperCase())
            .filter(Boolean)
        )
      ).slice(0, 50)
    : fallback.watchlist;

  return {
    enabled: bool(value.enabled, false),
    revision: Math.max(0, Math.floor(finite(value.revision, fallback.revision))),
    watchlist,
    watchlistRevision: Math.max(
      0,
      Math.floor(finite(value.watchlistRevision, fallback.watchlistRevision))
    ),
    fees: {
      currency: "USD",
      perOrderUsd: Math.max(0, finite(fees.perOrderUsd, fallback.fees.perOrderUsd)),
      entryPerContractUsd: Math.max(
        0,
        finite(fees.entryPerContractUsd, fallback.fees.entryPerContractUsd)
      ),
      exitPerContractUsd: Math.max(
        0,
        finite(fees.exitPerContractUsd, fallback.fees.exitPerContractUsd)
      ),
      expiryPerContractUsd: Math.max(
        0,
        finite(fees.expiryPerContractUsd, fallback.fees.expiryPerContractUsd)
      ),
      confirmed: bool(fees.confirmed, false),
    },
    horizons: {
      intraday: normalizeHorizon(horizonsRaw.intraday, fallback.horizons.intraday),
      swing: normalizeHorizon(horizonsRaw.swing, fallback.horizons.swing),
    },
    quotes: {
      maxUnderlyingAgeSeconds: Math.max(
        1,
        finite(quotes.maxUnderlyingAgeSeconds, fallback.quotes.maxUnderlyingAgeSeconds)
      ),
      maxOptionAgeSeconds: Math.max(
        1,
        finite(quotes.maxOptionAgeSeconds, fallback.quotes.maxOptionAgeSeconds)
      ),
      maxLegSkewSeconds: Math.max(
        1,
        finite(quotes.maxLegSkewSeconds, fallback.quotes.maxLegSkewSeconds)
      ),
      maxBidAskWidthPct: Math.max(
        0.1,
        finite(quotes.maxBidAskWidthPct, fallback.quotes.maxBidAskWidthPct)
      ),
      minVolume: Math.max(0, finite(quotes.minVolume, fallback.quotes.minVolume)),
      minOpenInterest: Math.max(
        0,
        finite(quotes.minOpenInterest, fallback.quotes.minOpenInterest)
      ),
      confirmed: bool(quotes.confirmed, false),
    },
    selection: {
      maxStrikesPerSide: Math.max(
        1,
        Math.floor(finite(selection.maxStrikesPerSide, fallback.selection.maxStrikesPerSide))
      ),
      targetStrikeDistancePct: Math.max(
        0,
        finite(selection.targetStrikeDistancePct, fallback.selection.targetStrikeDistancePct)
      ),
      maxStrikeDistancePct: Math.max(
        0.1,
        finite(selection.maxStrikeDistancePct, fallback.selection.maxStrikeDistancePct)
      ),
      minSpreadWidthPct: Math.max(
        0.1,
        finite(selection.minSpreadWidthPct, fallback.selection.minSpreadWidthPct)
      ),
      maxSpreadWidthPct: Math.max(
        0.1,
        finite(selection.maxSpreadWidthPct, fallback.selection.maxSpreadWidthPct)
      ),
      creditWingWidthPct: Math.max(
        0.1,
        finite(selection.creditWingWidthPct, fallback.selection.creditWingWidthPct)
      ),
      slippagePct: Math.max(0, finite(selection.slippagePct, fallback.selection.slippagePct)),
      confirmed: bool(selection.confirmed, false),
    },
    recipes,
    aiPricing,
    historyAssumptionAccepted: bool(value.historyAssumptionAccepted, false),
    maxWatchlistSymbols: Math.max(
      1,
      Math.floor(finite(value.maxWatchlistSymbols, fallback.maxWatchlistSymbols))
    ),
    scanIntervalMinutes: Math.max(
      1,
      Math.floor(finite(value.scanIntervalMinutes, fallback.scanIntervalMinutes))
    ),
    updatedAt: stringOrNull(value.updatedAt) ?? fallback.updatedAt,
  };
}

function validateRecipeParams(id: RecipeId, recipe: RecipeConfig): string[] {
  const issues: string[] = [];
  for (const definition of RECIPES[id].params) {
    const value = recipe.params[definition.key];
    if (!Number.isFinite(value)) {
      issues.push(`${definition.label} must be numeric`);
    } else if (value < definition.min || value > definition.max) {
      issues.push(
        `${definition.label} must be between ${definition.min}${definition.unit ?? ""} and ${
          definition.max
        }${definition.unit ?? ""}`
      );
    }
  }
  if (id === "MEAN-REVERSION") {
    if (recipe.params.rsiOversold >= recipe.params.rsiOverbought) {
      issues.push("RSI oversold must be below RSI overbought");
    }
  }
  if (id === "RANGE-BREAKOUT" && recipe.params.rangeBars < 2) {
    issues.push("Range lookback must include at least two bars");
  }
  if (
    (id === "VOLATILITY-RANGE" || id === "VOLATILITY-TREND-CREDIT") &&
    recipe.params.ivTenorMinDays > recipe.params.ivTenorMaxDays
  ) {
    issues.push("IV tenor minimum cannot exceed its maximum");
  }
  return issues;
}

export type IvReadiness = Partial<Record<RecipeId, { ready: boolean; issues: string[] }>>;

export function scannerReadiness(
  config: ScannerConfig,
  ivReadiness: IvReadiness = {}
): ScannerReadiness {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!config.fees.confirmed) issues.push("Fee assumptions must be reviewed and confirmed");
  if (!config.horizons.intraday.confirmed) {
    issues.push("Intraday expiry range must be reviewed and confirmed");
  }
  if (!config.horizons.swing.confirmed) {
    issues.push("Swing expiry range must be reviewed and confirmed");
  }
  for (const horizon of HORIZONS) {
    const range = config.horizons[horizon];
    if (range.minDays > range.maxDays) {
      issues.push(`${horizon} expiry minimum cannot exceed its maximum`);
    }
  }
  if (!config.quotes.confirmed) {
    issues.push("Quote age, skew, width, and liquidity limits must be confirmed");
  }
  if (!config.selection.confirmed) {
    issues.push("Contract selection and strike-enumeration policy must be confirmed");
  }
  if (!config.historyAssumptionAccepted) {
    issues.push("Provider history and adjusted-data assumptions must be reviewed");
  }
  if (config.selection.minSpreadWidthPct > config.selection.maxSpreadWidthPct) {
    issues.push("Minimum spread width cannot exceed maximum spread width");
  }
  if (config.selection.maxStrikeDistancePct < config.selection.targetStrikeDistancePct) {
    issues.push("Maximum strike distance cannot be below the target strike distance");
  }
  if (config.maxWatchlistSymbols < 1 || config.maxWatchlistSymbols > 50) {
    issues.push("Watchlist limit must be between 1 and 50 symbols");
  }
  if (config.scanIntervalMinutes < 1 || config.scanIntervalMinutes > 60) {
    issues.push("Scan interval must be between 1 and 60 minutes");
  }
  if (config.watchlist.length === 0) {
    warnings.push("Watchlist sync is empty; no symbols can be discovered");
  }
  if (config.aiPricing && !config.aiPricing.source.trim()) {
    warnings.push("AI pricing has no source/version; costs will remain unknown");
  }

  const recipes = RECIPE_IDS.map((id) => {
    const recipe = config.recipes[id];
    const baseIssues: string[] = [];
    if (recipe.enabled) {
      if (recipe.acceptedVersion !== RECIPES[id].version) {
        baseIssues.push(`Review and accept recipe version ${RECIPES[id].version}`);
      }
      if (!recipe.paramsApproved) {
        baseIssues.push("Recipe parameters must be explicitly approved");
      }
      baseIssues.push(...validateRecipeParams(id, recipe));
      issues.push(...baseIssues.map((issue) => `${RECIPES[id].name}: ${issue}`));
    }
    const iv = ivReadiness[id];
    if (iv && !iv.ready) {
      warnings.push(`${RECIPES[id].name}: ${iv.issues.join("; ")}`);
    }
    return {
      id,
      version: RECIPES[id].version,
      enabled: recipe.enabled,
      accepted:
        recipe.acceptedVersion === RECIPES[id].version && recipe.paramsApproved,
      ready: recipe.enabled && baseIssues.length === 0 && (iv?.ready ?? true),
      issues: [...baseIssues, ...(iv?.issues ?? [])],
      dataDependencies: RECIPES[id].dataDependencies,
    };
  });

  if (recipes.every((recipe) => !recipe.enabled)) {
    issues.push("Enable at least one reviewed recipe");
  }

  return {
    ready: issues.length === 0,
    enabled: config.enabled,
    issues: Array.from(new Set(issues)),
    warnings: Array.from(new Set(warnings)),
    recipes,
  };
}

export function activatedConfig(config: ScannerConfig): ScannerConfig {
  const next = clone(config);
  next.enabled = true;
  next.updatedAt = new Date().toISOString();
  return next;
}
