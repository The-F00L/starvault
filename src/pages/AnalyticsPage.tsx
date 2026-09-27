import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Timeline } from "../components/charts/Timeline";
import { repoPath } from "../components/RepoCard";
import { Card, cx, Icon, LanguageDot, PageHeader } from "../components/ui";
import { useMetaMap, useRepos } from "../hooks/useVault";
import { updateMeta } from "../lib/db";
import { fullNumber, relativeTime, shortDate } from "../lib/format";
import { healthBreakdown, languageBreakdown, staleCandidates, starsByMonth, summary, topTopics } from "../lib/stats";
import type { Health, Repo } from "../lib/types";
import { Pager } from "./StarsPage";

// Reserved status colors (dataviz status palette) — always paired with icon + label.
const HEALTH: Record<Health, { label: string; hint: string; color: string; icon: string }> = {
  active: { label: "Active", hint: "push < 30d", color: "#0ca30c", icon: "check_circle" },
  maintained: { label: "Maintained", hint: "push < 18mo", color: "#8fb4d9", icon: "radio_button_checked" },
  stale: { label: "Stale", hint: "no push 18mo+", color: "#ec835a", icon: "hourglass_bottom" },
  archived: { label: "Archived", hint: "read-only", color: "#d03b3b", icon: "inventory_2" },
};

type Range = "all" | "90d" | number;

function Kpi({ label, icon, value, unit, children }: { label: string; icon: string; value: string; unit?: string; children?: React.ReactNode }) {
  return (
    <Card className="p-4 flex flex-col gap-1 bg-gradient-to-br from-surface-container-low to-surface-container">
      <p className="flex items-start justify-between label-caps text-on-surface-variant">
        {label}
        <Icon name={icon} className="text-[1.125rem] text-primary" />
      </p>
      <p className="flex items-baseline gap-1.5 mt-2">
        <span className="text-headline-xl font-bold tracking-tight">{value}</span>
        {unit && <span className="font-mono text-code-sm text-primary">{unit}</span>}
      </p>
      <p className="text-body-sm text-on-surface-variant">{children}</p>
    </Card>
  );
}

function LanguageBars({ repos }: { repos: Repo[] }) {
  const rows = languageBreakdown(repos, 7);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const share = r.count / repos.length;
        const row = (
          <>
            <span className="flex items-center gap-2 w-28 shrink-0 text-body-md truncate">
              {r.language !== "Others" && <LanguageDot language={r.language} />}
              {r.language}
            </span>
            <span className="flex-1 h-3 rounded-sm bg-surface-container relative">
              <span
                className="absolute inset-y-0 left-0 rounded-r bg-primary-container group-hover:bg-primary transition-colors"
                style={{ width: `${(r.count / max) * 100}%`, minWidth: 2 }}
              />
            </span>
            <span className="w-24 shrink-0 text-right font-mono text-code-sm">
              {Math.round(share * 100)}% <span className="text-on-surface-variant">({fullNumber(r.count)})</span>
            </span>
          </>
        );
        return (
          <li key={r.language}>
            {r.language === "Others" ? (
              <div className="flex items-center gap-3">{row}</div>
            ) : (
              <Link to={`/lang/${encodeURIComponent(r.language)}`} className="group flex items-center gap-3 rounded focus-visible:outline-1">
                {row}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function HealthPanel({ repos }: { repos: Repo[] }) {
  const b = healthBreakdown(repos);
  const total = Math.max(1, repos.length);
  const keys = (Object.keys(HEALTH) as Health[]).filter((k) => b[k] > 0);
  return (
    <>
      <div className="flex h-3 gap-[2px] rounded overflow-hidden" role="img" aria-label={keys.map((k) => `${HEALTH[k].label} ${b[k]}`).join(", ")}>
        {keys.map((k) => (
          <span key={k} title={`${HEALTH[k].label}: ${b[k]} (${((b[k] / total) * 100).toFixed(1)}%)`} className="h-full hover:brightness-125" style={{ width: `${(b[k] / total) * 100}%`, background: HEALTH[k].color }} />
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
        {(Object.keys(HEALTH) as Health[]).map((k) => (
          <div key={k} className="p-3 rounded bg-surface-container">
            <p className="flex items-center gap-1 label-caps text-on-surface-variant">
              <Icon name={HEALTH[k].icon} className="text-[0.875rem]" fill />
              {HEALTH[k].label}
            </p>
            <p className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-full" style={{ background: HEALTH[k].color }} />
              <span className="text-headline-lg font-mono">{fullNumber(b[k])}</span>
            </p>
            <p className="font-mono text-code-sm text-on-surface-variant">
              {((b[k] / total) * 100).toFixed(1)}% · {HEALTH[k].hint}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

const STALE_PAGE = 8;

function StaleCleaner({ repos }: { repos: Repo[] }) {
  const meta = useMetaMap();
  const [page, setPage] = useState(1);

  const flagged = useMemo(
    () => staleCandidates(repos).filter((r) => !meta.get(r.fullName)?.keep).sort((a, b) => a.pushedAt.localeCompare(b.pushedAt)),
    [repos, meta],
  );
  const pages = Math.max(1, Math.ceil(flagged.length / STALE_PAGE));
  const current = Math.min(page, pages);
  const visible = flagged.slice((current - 1) * STALE_PAGE, current * STALE_PAGE);

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-headline-lg flex flex-wrap items-center gap-2">
          <Icon name="cleaning_services" className="text-error" /> Stale Stars Audit
          <span className="px-2 py-0.5 rounded bg-error-container/60 text-on-error-container label-caps">{flagged.length} flagged repos</span>
        </h2>
        <p className="text-on-surface-variant mt-1">
          Starred over 2 years ago and archived or without a push in 18+ months. Unstar them on GitHub, or mark them to keep.
        </p>
      </div>
      {flagged.length === 0 ? (
        <p className="py-8 text-center text-success">Nothing stale — your vault is in great shape.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-surface-container label-caps text-on-surface-variant text-left">
                <th className="p-3 font-semibold">Repository</th>
                <th className="p-3 font-semibold">Starred on</th>
                <th className="p-3 font-semibold">Last push</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold text-right">Stars</th>
                <th className="p-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.fullName} className="border-b border-surface-container-highest">
                  <td className="p-3 max-w-xs">
                    <Link to={repoPath(r)} className="hover:underline">
                      <span className="text-on-surface-variant text-body-sm">{r.owner}/</span>
                      <span className="text-secondary text-body-lg">{r.name}</span>
                    </Link>
                    <p className="text-body-sm text-on-surface-variant truncate">{r.description}</p>
                  </td>
                  <td className="p-3 font-mono text-code-sm whitespace-nowrap">{shortDate(r.starredAt)}</td>
                  <td className="p-3 font-mono text-code-sm whitespace-nowrap text-primary">{relativeTime(r.pushedAt)}</td>
                  <td className="p-3">
                    <span
                      className={cx(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded label-caps",
                        r.archived ? "bg-error-container text-on-error-container" : "bg-surface-container-high text-on-surface-variant",
                      )}
                    >
                      <Icon name={r.archived ? "inventory_2" : "bedtime"} className="text-[0.875rem]" />
                      {r.archived ? "Archived" : "Dormant"}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-code-sm text-right">{fullNumber(r.stars)}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <span className="inline-flex gap-1.5">
                      <a
                        href={r.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-1 rounded bg-error-container/40 text-error label-caps hover:bg-error-container/70"
                        title="Open on GitHub to unstar"
                      >
                        Unstar ↗
                      </a>
                      <button type="button" onClick={() => updateMeta(r.fullName, { keep: true })} className="px-2 py-1 rounded bg-surface-container-high label-caps hover:bg-surface-bright" title="Keep and hide from this audit">
                        Keep
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-body-sm text-on-surface-variant">
          <span>
            Showing {(current - 1) * STALE_PAGE + 1}–{Math.min(current * STALE_PAGE, flagged.length)} of {flagged.length} flagged
          </span>
          <Pager current={current} pages={pages} onPage={setPage} />
        </div>
      )}
    </Card>
  );
}

export function AnalyticsPage() {
  const loaded = useRepos();
  const all = loaded ?? [];
  const [range, setRange] = useState<Range>("all");

  const years = useMemo(() => [...new Set(all.map((r) => new Date(r.starredAt).getFullYear()))].sort((a, b) => b - a).slice(0, 3), [all]);
  const repos = useMemo(() => {
    if (range === "all") return all;
    if (range === "90d") return all.filter((r) => Date.now() - new Date(r.starredAt).getTime() < 90 * 86_400_000);
    return all.filter((r) => new Date(r.starredAt).getFullYear() === range);
  }, [all, range]);

  const s = summary(repos);
  const timeline = useMemo(() => starsByMonth(repos), [repos]);
  const topics = topTopics(repos, 16);
  const peak = timeline.reduce<{ month: string; count: number } | null>((m, d) => (!m || d.count > m.count ? d : m), null);
  const ranges: { key: Range; label: string }[] = [{ key: "all", label: "All time" }, ...years.map((y) => ({ key: y, label: String(y) })), { key: "90d", label: "Trailing 90d" }];

  if (!loaded) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Vault telemetry / Stargazing intelligence" title="Star Analytics & Insights">
        Audit of {fullNumber(all.length)} starred repositories — language mix, acquisition cadence, and maintenance decay.
      </PageHeader>

      <div className="flex flex-wrap items-center gap-1 p-1 bg-surface-container-low border border-surface-container-highest rounded self-start" role="group" aria-label="Time range">
        {ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cx("px-3 py-1.5 rounded label-caps", range === r.key ? "bg-surface-container-high text-primary" : "text-on-surface-variant hover:text-on-surface")}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3">
        <Kpi label="Total synced stars" icon="star" value={fullNumber(s.total)}>
          +{s.starredLast30d} in the last 30 days
        </Kpi>
        <Kpi label="Dominant dialect" icon="code" value={s.dominantLanguage?.language ?? "—"} unit={s.dominantLanguage ? `${Math.round(s.dominantLanguage.share * 100)}%` : undefined}>
          {s.runnerUpLanguage ? `${s.runnerUpLanguage.language} close 2nd (${s.runnerUpLanguage.count})` : " "}
        </Kpi>
        <Kpi label="Apex year" icon="event" value={s.apexYear ? String(s.apexYear.year) : "—"} unit={s.apexYear ? `${s.apexYear.count} repos` : undefined}>
          {peak ? `Peak month: ${peak.month} (${peak.count})` : " "}
        </Kpi>
        <Kpi label="Avg starred age" icon="schedule" value={`${s.avgAgeYears.toFixed(1)} yrs`}>
          Mean repository age since creation
        </Kpi>
        <Kpi label="Maintenance ratio" icon="verified_user" value={`${Math.round(s.maintenanceRatio * 100)}%`} unit="active">
          Pushed within the last 6 months
        </Kpi>
      </div>

      <div className="grid xl:grid-cols-[2fr_3fr] gap-6">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-headline-sm flex items-center gap-2">
              <Icon name="donut_large" className="text-primary" /> Language Spectrum
            </h2>
            <span className="font-mono text-code-sm text-on-surface-variant">{fullNumber(s.total)} projects</span>
          </div>
          <p className="text-body-sm text-on-surface-variant mb-5">Primary language across your starred repositories.</p>
          <LanguageBars repos={repos} />
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-headline-sm flex items-center gap-2">
              <Icon name="show_chart" className="text-primary" /> Stargazing Frequency
            </h2>
            <span className="font-mono text-code-sm text-on-surface-variant">stars / month</span>
          </div>
          <p className="text-body-sm text-on-surface-variant mb-4">
            {peak ? `Highest spike: ${peak.count} stars in ${peak.month}.` : "Acquisition cadence over time."}
          </p>
          <Timeline data={timeline} />
        </Card>
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        <Card className="p-5">
          <h2 className="text-headline-sm flex items-center gap-2 mb-1">
            <Icon name="health_and_safety" className="text-primary" /> Repository Health & Maintenance
          </h2>
          <p className="text-body-sm text-on-surface-variant mb-5">Distribution by last push and upstream archive status.</p>
          <HealthPanel repos={repos} />
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-headline-sm flex items-center gap-2">
              <Icon name="tag" className="text-primary" /> Top Topic Density
            </h2>
            <span className="font-mono text-code-sm text-on-surface-variant">{topTopics(repos, Infinity).length} unique topics</span>
          </div>
          <p className="text-body-sm text-on-surface-variant mb-5">Most frequent GitHub topics among your stars.</p>
          <div className="flex flex-wrap gap-2 items-baseline">
            {topics.map((t, i) => (
              <Link
                key={t.topic}
                to={`/?tag=${encodeURIComponent(t.topic)}`}
                className={cx(
                  "px-2 py-1 rounded bg-surface-container hover:bg-surface-container-high font-mono transition-colors",
                  i < 2 ? "text-headline-sm text-primary" : i < 6 ? "text-body-lg text-on-surface" : "text-code-sm text-on-surface-variant",
                )}
              >
                #{t.topic} <span className="text-code-sm text-secondary">{t.count}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <StaleCleaner repos={all} />
    </div>
  );
}
