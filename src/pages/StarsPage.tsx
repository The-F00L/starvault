import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { CollectionDialog } from "../components/CollectionDialog";
import { RepoCard, RepoRow, repoPath } from "../components/RepoCard";
import { Button, Chip, cx, EmptyState, GitHubListBadge, Icon, LanguageDot } from "../components/ui";
import { useSync } from "../hooks/SyncContext";
import { useCollections, useMetaMap, useRepos, useSettings } from "../hooks/useVault";
import { useToast } from "../hooks/Toast";
import { deleteCollection, githubListUrl } from "../lib/collections";
import { collectionShareUrl, encodeCollection } from "../lib/share";
import type { Collection, Repo } from "../lib/types";
import { compactNumber, fullNumber, relativeTime } from "../lib/format";
import { collectionMarkdown, filterRepos, languageCounts, sortRepos, type SortKey } from "../lib/stats";

const PAGE_SIZE = 12;

const SORTS: { key: SortKey; label: string }[] = [
  { key: "starred", label: "Recently Starred" },
  { key: "pushed", label: "Recently Updated" },
  { key: "stars", label: "Most Stars" },
  { key: "name", label: "Name" },
];

const selectClass =
  "h-8 pl-2 pr-7 bg-surface-container hover:bg-surface-container-high border border-surface-container-highest rounded font-mono text-code-sm text-on-surface focus:outline-none focus:border-secondary appearance-none bg-no-repeat bg-[right_0.4rem_center] bg-[length:1rem] bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23d2c5af'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E\")]";

export function StarsPage({ mode }: { mode: "all" | "recent" | "language" | "collection" }) {
  const { lang, id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const repos = useRepos();
  const meta = useMetaMap();
  const settings = useSettings();
  const { collections, members, membership } = useCollections();
  const { setSettingsOpen } = useSync();

  const view = params.get("view") === "list" ? "list" : "grid";
  const q = params.get("q") ?? "";
  const tags = params.getAll("tag");
  const language = mode === "language" ? (lang ?? null) : params.get("lang");
  const sort = (params.get("sort") as SortKey) ?? (mode === "recent" ? "pushed" : "starred");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const collection = mode === "collection" ? collections.find((c) => c.id === id) : undefined;

  const setParam = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    if (!next.has("page") || next.get("page") === "1") next.delete("page");
    setParams(next, { replace: true });
  };
  const resetPage = (p: URLSearchParams) => p.delete("page");

  const filtered = useMemo(() => {
    if (!repos) return [];
    const only = mode === "collection" ? (members.get(id ?? "") ?? new Set<string>()) : null;
    return sortRepos(filterRepos(repos, meta, { q, language, tags, only }), sort);
  }, [repos, meta, q, language, tags.join(","), sort, mode, id, members]);

  if (!repos) return null;

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const pinned = repos.filter((r) => meta.get(r.fullName)?.pinned);
  const organized = repos.filter((r) => membership.get(r.fullName)?.size).length;
  const langs = languageCounts(repos);
  const hasFilters = !!(q || tags.length || (mode !== "language" && language));
  const showVanguard = mode === "all" && !hasFilters && current === 1 && pinned.length > 0;

  const addTag = (t: string) => !tags.includes(t) && setParam((p) => (p.append("tag", t), resetPage(p)));

  const title =
    mode === "collection" ? (collection?.name ?? "Collection") : mode === "language" ? `${language} Stars` : mode === "recent" ? "Recently Updated" : "Main Starred Armory";

  if (mode === "collection" && !collection && collections.length > 0) {
    return <EmptyState icon="folder_off" title="Collection not found" />;
  }

  return (
    <div className="relative">
      <div className="absolute -top-32 -left-20 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-20 right-0 w-80 h-80 bg-secondary/10 rounded-full blur-3xl pointer-events-none" />

      {collection && <CollectionHeader collection={collection} repos={filtered} />}

      {/* Control hub */}
      <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-surface-container-low border border-surface-container-highest p-3 rounded-lg">
        <div className="flex flex-wrap items-center gap-2">
          {mode !== "language" && (
            <label className="flex items-center gap-1.5">
              <span className="sr-only">Language</span>
              <select
                className={selectClass}
                value={language ?? ""}
                onChange={(e) => setParam((p) => (e.target.value ? p.set("lang", e.target.value) : p.delete("lang"), resetPage(p)))}
              >
                <option value="">Language: All ({langs.length})</option>
                {langs.map((l) => (
                  <option key={l.language} value={l.language}>
                    {l.language} ({l.count})
                  </option>
                ))}
              </select>
            </label>
          )}
          <select className={selectClass} value={sort} onChange={(e) => setParam((p) => p.set("sort", e.target.value))} aria-label="Sort">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          {tags.map((t) => (
            <Chip key={t} onRemove={() => setParam((p) => { p.delete("tag"); tags.filter((x) => x !== t).forEach((x) => p.append("tag", x)); resetPage(p); })}>
              #{t}
            </Chip>
          ))}
          {q && (
            <Chip tone="primary" onRemove={() => setParam((p) => (p.delete("q"), resetPage(p)))}>
              “{q}”
            </Chip>
          )}
          {hasFilters && (
            <button
              type="button"
              className="font-mono text-code-sm text-on-surface-variant hover:text-primary underline decoration-dotted"
              onClick={() => setParam((p) => { p.delete("q"); p.delete("tag"); p.delete("lang"); resetPage(p); })}
            >
              Clear All
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center bg-surface-container p-0.5 rounded" role="group" aria-label="View mode">
            {(["grid", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                title={v === "grid" ? "Rich cards" : "Dense list"}
                onClick={() => setParam((p) => (v === "grid" ? p.delete("view") : p.set("view", v)))}
                className={cx("p-1.5 rounded", view === v ? "bg-surface-container-high text-primary" : "text-on-surface-variant hover:text-on-surface")}
              >
                <Icon name={v === "grid" ? "grid_view" : "view_headline"} className="text-[1.125rem]" />
              </button>
            ))}
          </div>
          <Button variant="primary" icon="add_circle" onClick={() => navigate("/collections?new=1")}>
            New Collection
          </Button>
        </div>
      </div>

      {/* Telemetry strip */}
      <div className="relative flex flex-wrap items-center gap-x-8 gap-y-2 px-3 py-3 font-mono text-code-sm text-on-surface-variant">
        <span className="flex items-center gap-1.5 text-on-surface">
          <Icon name="stars" className="text-[1rem] text-primary" />
          Showing {fullNumber(filtered.length)} of {fullNumber(repos.length)} starred repositories
        </span>
        <span>{fullNumber(organized)} organized into collections</span>
        <Link to="/collections" className="text-secondary hover:underline">
          {fullNumber(repos.length - organized)} uncategorized
        </Link>
        <span className="flex items-center gap-1.5">
          <span className={cx("w-1.5 h-1.5 rounded-full", settings.lastSyncedAt ? "bg-success" : "bg-primary")} />
          {settings.lastSyncedAt ? `Last synced ${relativeTime(settings.lastSyncedAt)}` : (
            <button type="button" className="text-primary hover:underline" onClick={() => setSettingsOpen(true)}>
              Demo data — connect GitHub
            </button>
          )}
        </span>
      </div>

      {showVanguard && (
        <section className="relative mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="label-caps text-on-surface-variant flex items-center gap-1.5">
              <Icon name="bolt" className="text-[1rem] text-primary" />
              Pinned Vanguard · High velocity favorites
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {pinned.slice(0, 8).map((r) => (
              <Link
                key={r.fullName}
                to={repoPath(r)}
                className="flex flex-col gap-2 p-4 bg-surface-container-low border border-surface-container-highest rounded-lg hover:border-primary-container/60 hover:shadow-[0_0_16px_rgba(227,179,65,0.15)] transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-code-sm text-on-surface-variant truncate">{r.owner}</p>
                    <p className="text-headline-sm text-secondary truncate">{r.name}</p>
                  </div>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-high font-mono text-code-sm text-primary">
                    <Icon name="star" fill className="text-[0.875rem]" />
                    {compactNumber(r.stars)}
                  </span>
                </div>
                <p className="text-body-sm text-on-surface-variant line-clamp-2">{r.description}</p>
                <span className="mt-auto flex items-center gap-1.5 font-mono text-code-sm">
                  <LanguageDot language={r.language} />
                  {r.language ?? "—"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="relative flex items-center gap-3 mb-4">
        <h2 className="text-headline-lg">{mode === "collection" ? "Members" : title}</h2>
        <span className="px-2 py-0.5 rounded bg-surface-container-high font-mono text-code-sm text-secondary">
          Page {current} of {pages}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="search_off" title={repos.length ? "No stars match" : "Your vault is empty"}>
          {repos.length ? (
            "Try clearing filters or a different search."
          ) : (
            <button type="button" className="text-secondary hover:underline" onClick={() => setSettingsOpen(true)}>
              Connect GitHub to sync your stars.
            </button>
          )}
          {mode === "collection" && repos.length > 0 && !hasFilters && (
            <p className="mt-2">
              Assign repos from any star card, or triage from the{" "}
              <Link className="text-secondary hover:underline" to="/collections">
                Collections page
              </Link>
              .
            </p>
          )}
        </EmptyState>
      ) : view === "grid" ? (
        <div className="relative grid grid-cols-1 xl:grid-cols-2 gap-4">
          {visible.map((r) => (
            <RepoCard
              key={r.fullName}
              repo={r}
              meta={meta.get(r.fullName)}
              collections={collections.filter((c) => membership.get(r.fullName)?.has(c.id))}
              onTag={addTag}
            />
          ))}
        </div>
      ) : (
        <div className="relative bg-surface-container-low border border-surface-container-highest rounded-lg">
          {visible.map((r) => (
            <RepoRow key={r.fullName} repo={r} meta={meta.get(r.fullName)} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav className="relative mt-6 flex flex-wrap items-center justify-between gap-3 p-3 bg-surface-container-low border border-surface-container-highest rounded-lg font-mono text-code-sm">
          <span className="text-on-surface-variant">
            {(current - 1) * PAGE_SIZE + 1} – {Math.min(current * PAGE_SIZE, filtered.length)} of {fullNumber(filtered.length)}
          </span>
          <Pager current={current} pages={pages} onPage={(n) => { setParam((p) => p.set("page", String(n))); window.scrollTo({ top: 0 }); }} />
        </nav>
      )}
    </div>
  );
}

export function CollectionHeader({ collection, repos }: { collection: Collection; repos: Repo[] }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const { attempt, notify } = useToast();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const linked = !!collection.githubListId;
  const url = githubListUrl(settings.username, collection);

  async function copyShareLink() {
    const ok = await attempt(async () => navigator.clipboard.writeText(collectionShareUrl(await encodeCollection(collection, repos))));
    if (ok) notify(`Share link for “${collection.name}” copied — anyone with it can view this collection`, "success");
  }

  return (
    <div className="relative flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
      <div className="flex items-start gap-3">
        <span className="w-11 h-11 rounded-lg bg-surface-container-high flex items-center justify-center text-primary shrink-0">
          <Icon name={collection.icon} className="text-[1.5rem]" />
        </span>
        <div>
          <p className="label-caps text-on-surface-variant flex items-center gap-2">
            {linked ? "GitHub List · read-only" : "Local collection"}
            {linked && <GitHubListBadge isPrivate={collection.isPrivate} />}
          </p>
          <h1 className="text-headline-lg">{collection.name}</h1>
          <p className="text-on-surface-variant max-w-2xl">{collection.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="accent" icon="share" onClick={copyShareLink} disabled={repos.length === 0}>
          Copy share link
        </Button>
        {url && (
          <a href={url} target="_blank" rel="noreferrer">
            <Button icon="open_in_new">Open on GitHub</Button>
          </a>
        )}
        <Button
          icon={copied ? "check" : "markdown"}
          onClick={async () => {
            await navigator.clipboard.writeText(collectionMarkdown(collection, repos));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy Awesome-List"}
        </Button>
        <Button icon="edit" onClick={() => setEditing(true)}>
          Edit
        </Button>
        {!linked &&
          (confirmDelete ? (
            <>
              <Button
                variant="danger"
                icon="delete"
                onClick={async () => {
                  if (await attempt(() => deleteCollection(collection))) navigate("/collections");
                }}
              >
                Confirm delete
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="danger" icon="delete" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ))}
      </div>
      <CollectionDialog open={editing} onClose={() => setEditing(false)} collection={collection} />
    </div>
  );
}

export function Pager({ current, pages, onPage }: { current: number; pages: number; onPage: (n: number) => void }) {
  const nums = [...new Set([1, current - 1, current, current + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const btn = "min-w-8 h-8 px-2 rounded flex items-center justify-center";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={cx(btn, "text-on-surface-variant hover:bg-surface-container-high")} disabled={current === 1} onClick={() => onPage(current - 1)} aria-label="Previous page">
        <Icon name="chevron_left" />
      </button>
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1">
          {i > 0 && n - nums[i - 1] > 1 && <span className="text-on-surface-variant px-1">…</span>}
          <button
            type="button"
            onClick={() => onPage(n)}
            className={cx(btn, n === current ? "bg-primary-container text-on-primary font-semibold" : "hover:bg-surface-container-high")}
          >
            {n}
          </button>
        </span>
      ))}
      <button type="button" className={cx(btn, "text-on-surface-variant hover:bg-surface-container-high")} disabled={current === pages} onClick={() => onPage(current + 1)} aria-label="Next page">
        <Icon name="chevron_right" />
      </button>
    </div>
  );
}
