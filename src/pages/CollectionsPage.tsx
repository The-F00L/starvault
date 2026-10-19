import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AssignMenu } from "../components/AssignMenu";
import { CollectionDialog } from "../components/CollectionDialog";
import { repoPath } from "../components/RepoCard";
import { Button, Card, cx, EmptyState, GitHubListBadge, Icon, PageHeader } from "../components/ui";
import { useCollections, useRepos } from "../hooks/useVault";
import { useToast } from "../hooks/Toast";
import { assignMany, setMembership } from "../lib/collections";
import { compactNumber, fullNumber, relativeTime } from "../lib/format";
import { collectionMarkdown, suggestCollections } from "../lib/stats";
import type { Collection, Repo } from "../lib/types";

function StatTile({ label, value, children, tone }: { label: string; value: string; children?: React.ReactNode; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="label-caps text-on-surface-variant">{label}</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className={cx("text-headline-lg font-mono", tone)}>{value}</span>
        <span className="font-mono text-code-sm text-on-surface-variant">{children}</span>
      </p>
    </Card>
  );
}

function CollectionCard({ collection, repos, onEdit }: { collection: Collection; repos: Repo[]; onEdit: () => void }) {
  const pooled = repos.reduce((s, r) => s + r.stars, 0);
  const top = [...repos].sort((a, b) => b.stars - a.stars).slice(0, 3);
  return (
    <Card className="flex flex-col hover:border-secondary/40 transition-colors">
      <div className="p-5 flex flex-col gap-3 flex-1">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded bg-surface-container-high flex items-center justify-center text-secondary shrink-0">
            <Icon name={collection.icon} />
          </span>
          <Link to={`/collections/${collection.id}`} className="flex-1 min-w-0 group">
            <h3 className="text-headline-sm group-hover:text-secondary truncate flex items-center gap-2">
              <span className="truncate">{collection.name}</span>
              {collection.githubListId && <GitHubListBadge isPrivate={collection.isPrivate} />}
            </h3>
            <p className="font-mono text-code-sm text-secondary">{repos.length} repositories</p>
          </Link>
          <button type="button" onClick={onEdit} className="text-on-surface-variant hover:text-on-surface" aria-label="Edit collection">
            <Icon name="more_vert" />
          </button>
        </div>
        <p className="text-body-md text-on-surface-variant line-clamp-2">{collection.description || "No description."}</p>
        {top.length > 0 && (
          <div className="flex items-center gap-2 mt-auto">
            <div className="flex -space-x-2">
              {top.map((r) => (
                <img key={r.fullName} src={r.ownerAvatar} alt="" loading="lazy" className="w-6 h-6 rounded-full ring-2 ring-surface-container-low bg-surface-container-high" />
              ))}
            </div>
            <span className="font-mono text-code-sm text-on-surface-variant truncate">{top.map((r) => r.name).join(", ")}</span>
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-surface-container-highest bg-surface-container flex items-center justify-between label-caps text-on-surface-variant rounded-b-lg">
        <span>Updated {relativeTime(collection.updatedAt)}</span>
        <span className="flex items-center gap-1 normal-case">
          <Icon name="star" className="text-[0.875rem] text-primary" /> {compactNumber(pooled)} stars pooled
        </span>
      </div>
    </Card>
  );
}

function UnsortedPanel({ unsorted, collections }: { unsorted: Repo[]; collections: Collection[] }) {
  const [classifying, setClassifying] = useState(false);
  const { attempt } = useToast();
  // GitHub Lists are read-only here; only suggest local collections.
  const writable = collections.filter((c) => !c.githubListId);
  const shown = unsorted.slice(0, 6);

  async function autoClassify() {
    const assignments = unsorted.flatMap((r) => {
      const [best] = suggestCollections(r, writable, 1);
      return best ? [{ collectionId: best.id, fullName: r.fullName, member: true }] : [];
    });
    setClassifying(true);
    await attempt(() => assignMany(assignments), `Classified ${assignments.length} repositories`);
    setClassifying(false);
  }

  return (
    <Card className="p-4 flex flex-col gap-3 self-start">
      <div className="flex items-center justify-between">
        <h2 className="text-headline-sm flex items-center gap-2">
          <Icon name="inbox" className="text-primary" /> Unsorted Stars
        </h2>
        <span className="font-mono text-code-sm text-on-surface-variant">{fullNumber(unsorted.length)} pending</span>
      </div>
      <p className="text-body-sm text-on-surface-variant">Triage newly starred repositories into your collections with one click.</p>
      {shown.map((r) => {
        const suggestions = suggestCollections(r, writable, 2);
        return (
          <div key={r.fullName} className="p-3 rounded bg-surface-container flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Link to={repoPath(r)} className="font-mono text-code-sm truncate hover:underline">
                <span className="text-secondary">{r.owner}</span>
                <span className="text-on-surface-variant"> / </span>
                {r.name}
              </Link>
              <span className="font-mono text-code-sm text-primary shrink-0">★ {compactNumber(r.stars)}</span>
            </div>
            <p className="text-body-sm text-on-surface-variant truncate">{r.description}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="label-caps text-on-surface-variant">Assign:</span>
              {suggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => attempt(() => setMembership(c.id, r.fullName, true))}
                  className="px-2 py-0.5 rounded bg-surface-container-high font-mono text-code-sm text-secondary hover:bg-accent/20"
                >
                  + {c.name}
                </button>
              ))}
              <AssignMenu
                fullName={r.fullName}
                trigger={(toggle) => (
                  <button type="button" onClick={toggle} className="px-1.5 py-0.5 rounded font-mono text-code-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high">
                    {suggestions.length ? "…" : "Choose…"}
                  </button>
                )}
              />
            </div>
          </div>
        );
      })}
      {unsorted.length === 0 && <p className="py-4 text-center text-body-sm text-success">Inbox zero — every star is organized.</p>}
      {unsorted.length > 0 && (
        <button
          type="button"
          onClick={autoClassify}
          disabled={classifying || writable.every((c) => c.rules.length === 0)}
          className="flex flex-col items-center gap-1 p-4 border border-dashed border-surface-container-highest rounded hover:border-primary/60 disabled:opacity-40 transition-colors"
        >
          <Icon name="auto_fix_high" className="text-primary" />
          <span className="text-body-md">{classifying ? "Classifying…" : "Batch Auto-Classify"}</span>
          <span className="font-mono text-code-sm text-on-surface-variant text-center">Assign each unsorted star to its best matching collection by auto-tag rules</span>
        </button>
      )}
    </Card>
  );
}

function ExportPanel({ collections, members, repos }: { collections: Collection[]; members: Map<string, Set<string>>; repos: Repo[] }) {
  const [selected, setSelected] = useState(collections[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const collection = collections.find((c) => c.id === selected) ?? collections[0];
  const md = useMemo(() => {
    if (!collection) return "";
    const set = members.get(collection.id) ?? new Set();
    return collectionMarkdown(collection, repos.filter((r) => set.has(r.fullName)));
  }, [collection, members, repos]);
  if (!collection) return null;
  const slug = collection.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div>
          <h2 className="text-headline-sm">Export & Share Knowledge Hubs</h2>
          <p className="text-body-sm text-on-surface-variant">Publish a collection as a curated Awesome-List.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={collection.id}
            onChange={(e) => setSelected(e.target.value)}
            className="h-8 px-2 bg-surface-container border border-surface-container-highest rounded font-mono text-code-sm focus:outline-none focus:border-secondary"
            aria-label="Collection to export"
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            icon={copied ? "check" : "content_copy"}
            onClick={async () => {
              await navigator.clipboard.writeText(md);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy Markdown"}
          </Button>
          <Button
            variant="accent"
            icon="download"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
              Object.assign(document.createElement("a"), { href: url, download: `awesome-${slug}.md` }).click();
              URL.revokeObjectURL(url);
            }}
          >
            Download .md
          </Button>
        </div>
      </div>
      <div className="bg-surface-container-lowest border border-surface-container-highest rounded p-4">
        <p className="flex justify-between label-caps text-on-surface-variant mb-3">
          <span>Markdown preview // awesome-{slug}.md</span>
          <span>Generated just now</span>
        </p>
        <pre className="font-mono text-code-sm whitespace-pre-wrap max-h-72 overflow-auto">{md}</pre>
      </div>
    </Card>
  );
}

export function CollectionsPage() {

  const loaded = useRepos();
  const repos = loaded ?? [];
  const { collections, members, membership } = useCollections();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Collection | undefined>();
  // Dialog state is local so it opens instantly; react-router applies URL changes as low-priority
  // transitions, which delayed the dialog by up to seconds and let clicks/typing hit the page behind it.
  // `?new=1` (used by the "New Collection" button on star lists) is a one-shot trigger consumed on arrival.
  const [creating, setCreating] = useState(() => params.get("new") === "1");
  useEffect(() => {
    if (params.get("new") === "1") {
      setCreating(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const byName = useMemo(() => new Map(repos.map((r) => [r.fullName, r])), [repos]);
  const unsorted = useMemo(
    () => repos.filter((r) => !membership.get(r.fullName)?.size).sort((a, b) => b.starredAt.localeCompare(a.starredAt)),
    [repos, membership],
  );
  const categorized = repos.length - unsorted.length;
  const rules = collections.reduce((s, c) => s + c.rules.length, 0);
  const newThisWeek = collections.filter((c) => Date.now() - new Date(c.createdAt).getTime() < 7 * 86_400_000).length;

  if (!loaded) return null;

  return (
    <div>
      <PageHeader
        eyebrow="Telemetry // Knowledge indexer"
        title="Collections & Custom Lists"
        actions={
          <Button variant="primary" icon="add_circle" onClick={() => setCreating(true)} className="text-body-md px-4 py-2">
            New Collection
          </Button>
        }
      >
        Organize your {fullNumber(repos.length)} stars into focused workspaces and exportable lists.
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatTile label="Active vaults" value={String(collections.length)}>
          {newThisWeek > 0 && <span className="text-secondary">+{newThisWeek} this week</span>}
        </StatTile>
        <StatTile label="Categorized stars" value={fullNumber(categorized)}>
          / {fullNumber(repos.length)} repos
        </StatTile>
        <StatTile label="Needs review" value={fullNumber(unsorted.length)} tone="text-primary">
          unsorted
        </StatTile>
        <StatTile label="Classification rules" value={String(rules)}>
          across {collections.length} vaults
        </StatTile>
      </div>

      <div className="grid xl:grid-cols-[1fr_22rem] gap-6 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-headline-sm">Managed Collections</h2>
            <span className="px-2 py-0.5 rounded bg-surface-container-high font-mono text-code-sm">{collections.length} boards</span>
          </div>
          {collections.length === 0 ? (
            <EmptyState icon="create_new_folder" title="No collections yet">
              <button type="button" className="text-secondary hover:underline" onClick={() => setCreating(true)}>
                Create your first collection
              </button>
            </EmptyState>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {collections.map((c) => (
                <CollectionCard
                  key={c.id}
                  collection={c}
                  repos={[...(members.get(c.id) ?? [])].flatMap((n) => byName.get(n) ?? [])}
                  onEdit={() => setEditing(c)}
                />
              ))}
            </div>
          )}
        </div>
        <UnsortedPanel unsorted={unsorted} collections={collections} />
      </div>

      <ExportPanel collections={collections} members={members} repos={repos} />

      <CollectionDialog open={creating} onClose={() => setCreating(false)} />
      <CollectionDialog open={!!editing} onClose={() => setEditing(undefined)} collection={editing} />
    </div>
  );
}
