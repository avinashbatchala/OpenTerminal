"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiPut } from "../../lib/api";
import type { Horizon, RecipeId, ScannerConfig, ScannerStatus } from "../../lib/scanner";

type Props = {
  status: ScannerStatus;
};

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  title,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  title?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]" title={title}>
      <span className="dim flex-1 min-w-0 truncate">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-20 text-right"
      />
      {unit && <span className="dim w-12 shrink-0">{unit}</span>}
    </label>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-2 text-[11px] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 accent-[var(--amber)]"
      />
      <span>{children}</span>
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-[var(--border)] bg-[var(--panel)]">
      <div className="panel-title cursor-default">{title}</div>
      <div className="p-2 space-y-2">{children}</div>
    </div>
  );
}

export default function ScannerConfigPanel({ status }: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ScannerConfig>(status.config);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAiPricing, setShowAiPricing] = useState(Boolean(status.config.aiPricing));

  useEffect(() => {
    setDraft(status.config);
    setShowAiPricing(Boolean(status.config.aiPricing));
  }, [status.config.revision, status.config.updatedAt]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["scanner"] });
  };

  const save = useMutation({
    mutationFn: async (activate: boolean) => {
      await apiPut("/api/scanner/config", { config: draft });
      if (activate) await apiPost("/api/scanner/activate", {});
    },
    onSuccess: async (_data, activate) => {
      setNotice(
        activate
          ? "Scanner activated. Background scans will only run during verified US regular-session hours."
          : "Draft configuration saved. Scanning remains paused."
      );
      await refresh();
    },
    onError: async (error: Error) => {
      setNotice(error.message);
      await refresh();
    },
  });

  const pause = useMutation({
    mutationFn: () => apiPost("/api/scanner/pause", {}),
    onSuccess: async () => {
      setNotice("Scanner paused. Existing setups and history were preserved.");
      await refresh();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const setHorizon = (horizon: Horizon, patch: Partial<ScannerConfig["horizons"][Horizon]>) => {
    setDraft((current) => ({
      ...current,
      horizons: {
        ...current.horizons,
        [horizon]: { ...current.horizons[horizon], ...patch },
      },
    }));
  };

  const setRecipe = (id: RecipeId, patch: Partial<ScannerConfig["recipes"][RecipeId]>) => {
    setDraft((current) => ({
      ...current,
      recipes: {
        ...current.recipes,
        [id]: { ...current.recipes[id], ...patch },
      },
    }));
  };

  const setParam = (id: RecipeId, key: string, value: number) => {
    setDraft((current) => ({
      ...current,
      recipes: {
        ...current.recipes,
        [id]: {
          ...current.recipes[id],
          params: { ...current.recipes[id].params, [key]: value },
        },
      },
    }));
  };

  const aiPricing = draft.aiPricing ?? {
    source: "",
    inputPerMillionUsd: 0,
    outputPerMillionUsd: 0,
    cacheReadPerMillionUsd: 0,
    cacheWritePerMillionUsd: 0,
  };

  const setAiPricing = (
    key: keyof typeof aiPricing,
    value: string | number
  ) => {
    const next = { ...aiPricing, [key]: value };
    const enabled =
      next.source.trim() ||
      next.inputPerMillionUsd > 0 ||
      next.outputPerMillionUsd > 0 ||
      next.cacheReadPerMillionUsd > 0 ||
      next.cacheWritePerMillionUsd > 0;
    setDraft((current) => ({ ...current, aiPricing: enabled ? next : null }));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="term-btn"
          onClick={() => save.mutate(false)}
          disabled={save.isPending}
        >
          SAVE DRAFT
        </button>
        <button
          type="button"
          className="term-btn"
          onClick={() => save.mutate(true)}
          disabled={save.isPending}
        >
          SAVE &amp; ACTIVATE
        </button>
        <button
          type="button"
          className="term-btn"
          onClick={() => pause.mutate()}
          disabled={pause.isPending || !status.config.enabled}
        >
          PAUSE
        </button>
        <span className="dim text-[11px]">
          Scanner is {status.config.enabled ? "enabled; background scans follow session checks" : "disabled by default"}.
          Suggested values below are drafts and do not become active until reviewed.
        </span>
      </div>

      {notice && <div className="text-[11px] amber">{notice}</div>}
      {!status.readiness.ready && (
        <div className="border border-[var(--down)] text-[11px] p-2 space-y-1">
          <div className="down font-bold">Activation is blocked</div>
          <ul className="list-disc pl-4 dim space-y-0.5">
            {status.readiness.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {status.readiness.warnings.length > 0 && (
        <div className="border border-[var(--border)] text-[11px] p-2 text-[var(--text-dim)]">
          {status.readiness.warnings.join(" · ")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <Section title="Fees">
          <NumberField label="Per order" value={draft.fees.perOrderUsd} onChange={(value) => setDraft((current) => ({ ...current, fees: { ...current.fees, perOrderUsd: value } }))} min={0} step={0.01} unit="USD" title="Charged on entry and exit orders in the modeled loss assumptions." />
          <NumberField label="Entry per contract" value={draft.fees.entryPerContractUsd} onChange={(value) => setDraft((current) => ({ ...current, fees: { ...current.fees, entryPerContractUsd: value } }))} min={0} step={0.01} unit="USD" />
          <NumberField label="Exit per contract" value={draft.fees.exitPerContractUsd} onChange={(value) => setDraft((current) => ({ ...current, fees: { ...current.fees, exitPerContractUsd: value } }))} min={0} step={0.01} unit="USD" />
          <NumberField label="Expiry per contract" value={draft.fees.expiryPerContractUsd} onChange={(value) => setDraft((current) => ({ ...current, fees: { ...current.fees, expiryPerContractUsd: value } }))} min={0} step={0.01} unit="USD" />
          <Check checked={draft.fees.confirmed} onChange={(checked) => setDraft((current) => ({ ...current, fees: { ...current.fees, confirmed: checked } }))}>
            I reviewed these fee components. Entry, exit, and expiry charges are included in the $250 modeled-loss screen.
          </Check>
        </Section>

        <Section title="Expiry ranges">
          <div className="dim text-[10px] uppercase tracking-wide">Intraday</div>
          <NumberField label="Minimum days" value={draft.horizons.intraday.minDays} onChange={(value) => setHorizon("intraday", { minDays: value })} min={0} step={1} unit="days" />
          <NumberField label="Maximum days" value={draft.horizons.intraday.maxDays} onChange={(value) => setHorizon("intraday", { maxDays: value })} min={0} step={1} unit="days" />
          <Check checked={draft.horizons.intraday.confirmed} onChange={(checked) => setHorizon("intraday", { confirmed: checked })}>
            Confirm the intraday expiry range.
          </Check>
          <div className="dim text-[10px] uppercase tracking-wide pt-1">Swing</div>
          <NumberField label="Minimum days" value={draft.horizons.swing.minDays} onChange={(value) => setHorizon("swing", { minDays: value })} min={0} step={1} unit="days" />
          <NumberField label="Maximum days" value={draft.horizons.swing.maxDays} onChange={(value) => setHorizon("swing", { maxDays: value })} min={0} step={1} unit="days" />
          <Check checked={draft.horizons.swing.confirmed} onChange={(checked) => setHorizon("swing", { confirmed: checked })}>
            Confirm the swing expiry range. Swing deadlines use expiry-day regular-session open unless a recipe ends earlier.
          </Check>
        </Section>

        <Section title="Quotes and liquidity">
          <NumberField label="Underlying max age" value={draft.quotes.maxUnderlyingAgeSeconds} onChange={(value) => setDraft((current) => ({ ...current, quotes: { ...current.quotes, maxUnderlyingAgeSeconds: value } }))} min={1} step={1} unit="sec" />
          <NumberField label="Option max age" value={draft.quotes.maxOptionAgeSeconds} onChange={(value) => setDraft((current) => ({ ...current, quotes: { ...current.quotes, maxOptionAgeSeconds: value } }))} min={1} step={1} unit="sec" />
          <NumberField label="Inter-leg skew" value={draft.quotes.maxLegSkewSeconds} onChange={(value) => setDraft((current) => ({ ...current, quotes: { ...current.quotes, maxLegSkewSeconds: value } }))} min={1} step={1} unit="sec" />
          <NumberField label="Maximum bid/ask width" value={draft.quotes.maxBidAskWidthPct} onChange={(value) => setDraft((current) => ({ ...current, quotes: { ...current.quotes, maxBidAskWidthPct: value } }))} min={0.1} step={0.1} unit="%" />
          <NumberField label="Minimum volume" value={draft.quotes.minVolume} onChange={(value) => setDraft((current) => ({ ...current, quotes: { ...current.quotes, minVolume: value } }))} min={0} step={1} />
          <NumberField label="Minimum open interest" value={draft.quotes.minOpenInterest} onChange={(value) => setDraft((current) => ({ ...current, quotes: { ...current.quotes, minOpenInterest: value } }))} min={0} step={1} />
          <Check checked={draft.quotes.confirmed} onChange={(checked) => setDraft((current) => ({ ...current, quotes: { ...current.quotes, confirmed: checked } }))}>
            Confirm quote-age, skew, width, volume, and open-interest gates. Missing or stale data will hold candidates rather than qualify them.
          </Check>
        </Section>

        <Section title="Contract selection and risk">
          <NumberField label="Maximum strikes per side" value={draft.selection.maxStrikesPerSide} onChange={(value) => setDraft((current) => ({ ...current, selection: { ...current.selection, maxStrikesPerSide: value } }))} min={1} step={1} />
          <NumberField label="Target strike distance" value={draft.selection.targetStrikeDistancePct} onChange={(value) => setDraft((current) => ({ ...current, selection: { ...current.selection, targetStrikeDistancePct: value } }))} min={0} step={0.1} unit="%" />
          <NumberField label="Maximum strike distance" value={draft.selection.maxStrikeDistancePct} onChange={(value) => setDraft((current) => ({ ...current, selection: { ...current.selection, maxStrikeDistancePct: value } }))} min={0.1} step={0.1} unit="%" />
          <NumberField label="Minimum spread width" value={draft.selection.minSpreadWidthPct} onChange={(value) => setDraft((current) => ({ ...current, selection: { ...current.selection, minSpreadWidthPct: value } }))} min={0.1} step={0.1} unit="%" />
          <NumberField label="Maximum spread width" value={draft.selection.maxSpreadWidthPct} onChange={(value) => setDraft((current) => ({ ...current, selection: { ...current.selection, maxSpreadWidthPct: value } }))} min={0.1} step={0.1} unit="%" />
          <NumberField label="Credit wing width" value={draft.selection.creditWingWidthPct} onChange={(value) => setDraft((current) => ({ ...current, selection: { ...current.selection, creditWingWidthPct: value } }))} min={0.1} step={0.1} unit="%" />
          <NumberField label="Slippage scenario" value={draft.selection.slippagePct} onChange={(value) => setDraft((current) => ({ ...current, selection: { ...current.selection, slippagePct: value } }))} min={0} step={0.5} unit="%" title="Displayed separately; not included in the $250 modeled-loss limit." />
          <NumberField label="Watchlist limit" value={draft.maxWatchlistSymbols} onChange={(value) => setDraft((current) => ({ ...current, maxWatchlistSymbols: value }))} min={1} max={50} step={1} />
          <Check checked={draft.selection.confirmed} onChange={(checked) => setDraft((current) => ({ ...current, selection: { ...current.selection, confirmed: checked } }))}>
            Confirm the bounded, deterministic strike/expiry policy. It does not choose inferior contracts to force risk below $250.
          </Check>
          <Check checked={draft.historyAssumptionAccepted} onChange={(checked) => setDraft((current) => ({ ...current, historyAssumptionAccepted: checked }))}>
            I reviewed the provider-history assumption: completed bars are treated as raw provider data, and adjusted-data consistency is not independently verified.
          </Check>
        </Section>
      </div>

      <Section title="AI assessment pricing (optional)">
        <Check
          checked={showAiPricing}
          onChange={(checked) => {
            setShowAiPricing(checked);
            if (!checked) setDraft((current) => ({ ...current, aiPricing: null }));
          }}
        >
          Record a pricing source/version and rate assumptions for estimated AI cost.
        </Check>
        {showAiPricing && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-[11px]">
              <span className="dim flex-1">Pricing source/version</span>
              <input value={aiPricing.source} onChange={(event) => setAiPricing("source", event.target.value)} placeholder="e.g. provider price sheet 2026-01" className="flex-1" />
            </label>
            <NumberField label="Input / million" value={aiPricing.inputPerMillionUsd} onChange={(value) => setAiPricing("inputPerMillionUsd", value)} min={0} step={0.01} unit="USD" />
            <NumberField label="Output / million" value={aiPricing.outputPerMillionUsd} onChange={(value) => setAiPricing("outputPerMillionUsd", value)} min={0} step={0.01} unit="USD" />
            <NumberField label="Cache read / million" value={aiPricing.cacheReadPerMillionUsd} onChange={(value) => setAiPricing("cacheReadPerMillionUsd", value)} min={0} step={0.01} unit="USD" />
            <NumberField label="Cache write / million" value={aiPricing.cacheWritePerMillionUsd} onChange={(value) => setAiPricing("cacheWritePerMillionUsd", value)} min={0} step={0.01} unit="USD" />
          </div>
        )}
        <div className="dim text-[10px]">
          Actual SDK token usage is always recorded. If no pricing source is supplied, estimated cost remains visibly unknown.
        </div>
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        {status.definitions.map((definition) => {
          const recipe = draft.recipes[definition.id];
          const readiness = status.readiness.recipes.find((entry) => entry.id === definition.id);
          return (
            <Section key={definition.id} title={`${definition.name} · v${definition.version}`}>
              <div className="text-[11px] dim">{definition.description}</div>
              <div className="text-[10px] dim">
                Horizons: {definition.horizons.join(", ")} · Data: {definition.dataDependencies.join(", ")}
              </div>
              <div className="flex flex-wrap gap-3">
                <Check checked={recipe.enabled} onChange={(checked) => setRecipe(definition.id, { enabled: checked })}>
                  Enable this recipe
                </Check>
                <Check checked={recipe.acceptedVersion === definition.version} onChange={(checked) => setRecipe(definition.id, { acceptedVersion: checked ? definition.version : null })}>
                  Accept version {definition.version}
                </Check>
                <Check checked={recipe.paramsApproved} onChange={(checked) => setRecipe(definition.id, { paramsApproved: checked })}>
                  Approve these parameter values
                </Check>
              </div>
              {!recipe.paramsApproved && <div className="amber text-[10px]">Draft defaults — not approved for activation.</div>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-1">
                {definition.params.map((param) => (
                  <NumberField
                    key={param.key}
                    label={param.label}
                    value={recipe.params[param.key] ?? param.default}
                    onChange={(value) => setParam(definition.id, param.key, value)}
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    unit={param.unit}
                    title={param.description}
                  />
                ))}
              </div>
              {readiness && readiness.issues.length > 0 && (
                <div className="down text-[10px]">{readiness.issues.join(" · ")}</div>
              )}
              {readiness?.dataDependencies && (
                <div className="dim text-[10px]">Readiness: {readiness.ready ? "ready" : "not ready"}</div>
              )}
            </Section>
          );
        })}
      </div>
    </div>
  );
}
