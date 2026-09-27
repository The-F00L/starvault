import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import { AssignMenu } from "../components/AssignMenu";
import { Markdown } from "../components/Markdown";
import { repoPath } from "../components/RepoCard";
import { Button, Card, Chip, cx, EmptyState, GitHubListBadge, Icon, inputClass, LanguageDot } from "../components/ui";
import { useGitHubResource } from "../hooks/useGitHubResource";
import { useCollections, useMetaMap, useRepos } from "../hooks/useVault";
import { useToast } from "../hooks/Toast";
import { setMembership } from "../lib/collections";
import { updateMeta } from "../lib/db";
import { compactNumber, fullNumber, relativeTime, shortDate } from "../lib/format";
import { fetchContributors, fetchReadme, fetchReleases } from "../lib/api";
import type { Repo } from "../lib/types";

type Tab = "readme" | "releases" | "contributors" | "similar";

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="p-3 bg-surface-container rounded">
      <p className="label-caps text-on-surface-variant">{label}</p>
      <p className={cx("font-mono text-code-md mt-1", tone)}>{fullNumber(value)}</p>
    </div>
  );
}

function ActiveFeed({ repos, current }: { repos: Repo[]; current: string }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const needle = q.toLowerCase();
    return [...repos].sort((a, b) => b.starredAt.localeCompare(a.starredAt)).filter((r) => r.fullName.toLowerCase().includes(needle)).slice(0, 12);
  }, [repos, q]);
  return (
    <aside className="hidden 2xl:flex flex-col gap-2 w-60 shrink-0 sticky top-22 self-start">
      <p className="label-caps text-on-surface-variant flex items-center justify-between px-1">
        <span className="flex items-center gap-1">
          <Icon name="swap_vert" className="text-[0.875rem] text-primary" /> Active feed
        </span>
        <span className="opacity-60">{list.length} in view</span>
      </p>
      <input className={cx(inputClass, "h-8 font-mono text-code-sm")} placeholder="Quick switch repo…" value={q} onChange={(e) => setQ(e.target.value)} />
      <nav className="flex flex-col gap-1">
        {list.map((r) => (
          <NavLink
            key={r.fullName}
            to={repoPath(r)}
            className={cx(
              "flex flex-col gap-0.5 p-2.5 rounded border-l-2 transition-colors",
              r.fullName === current ? "bg-surface-container-high border-primary" : "border-transparent bg-surface-container-low hover:bg-surface-container",
            )}
          >
            <span className="flex items-center justify-between gap-2 font-mono text-code-sm">
              <span className={cx("truncate", r.fullName === current ? "text-primary" : "text-on-surface")}>{r.fullName}</span>
              <span className="text-primary shrink-0">★ {compactNumber(r.stars)}</span>
            </span>
            <span className="text-body-sm text-on-surface-variant truncate">{r.description}</span>
            <span className="flex items-center gap-1.5 font-mono text-[0.6875rem] text-on-surface-variant">
              <LanguageDot language={r.language} className="w-1.5 h-1.5" /> {r.language ?? "—"} · {relativeTime(r.pushedAt)}
            </span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function WorkspaceMeta({ repo }: { repo: Repo }) {
  const metaMap = useMetaMap();
  const meta = metaMap.get(repo.fullName);
  const { collections, membership } = useCollections();
  const { attempt } = useToast();
  const assigned = collections.filter((c) => membership.get(repo.fullName)?.has(c.id));
  const [note, setNote] = useState(meta?.note ?? "");
  const [tag, setTag] = useState("");
  const [addingTag, setAddingTag] = useState(false);

  useEffect(() => setNote(meta?.note ?? ""), [repo.fullName, meta?.note]);
  const dirty = note !== (meta?.note ?? "");

  function addTag() {
    const t = tag.trim().replace(/^#/, "").toLowerCase();
    if (t && !meta?.tags.includes(t)) updateMeta(repo.fullName, { tags: [...(meta?.tags ?? []), t] });
    setTag("");
    setAddingTag(false);
  }

  return (
    <Card className="p-5 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-headline-sm flex items-center gap-2">
          <Icon name="folder_special" className="text-primary" /> StarVault Workspace Metadata
        </h2>
        <span className="font-mono text-code-sm text-on-surface-variant">
          Starred on {shortDate(repo.starredAt)} ({relativeTime(repo.starredAt)})
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="label-caps text-on-surface-variant">Personal knowledge note</span>
          <button
            type="button"
            className="label-caps text-secondary disabled:opacity-40"
            disabled={!dirty}
            onClick={() => updateMeta(repo.fullName, { note: note.trim() })}
          >
            {dirty ? "Save note" : "Saved"}
          </button>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && updateMeta(repo.fullName, { note: note.trim() })}
          onBlur={() => dirty && updateMeta(repo.fullName, { note: note.trim() })}
          placeholder="Why did you star this? What is it good for?"
          className={cx(inputClass, "h-24 py-2 font-mono text-code-md resize-y")}
        />
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="flex flex-col gap-2">
          <span className="label-caps text-on-surface-variant">Custom user tags</span>
          <div className="flex flex-wrap gap-1.5 items-center">
            {meta?.tags.map((t) => (
              <Chip key={t} onRemove={() => updateMeta(repo.fullName, { tags: meta.tags.filter((x) => x !== t) })}>
                #{t}
              </Chip>
            ))}
            {addingTag ? (
              <input
                autoFocus
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => (e.key === "Enter" ? addTag() : e.key === "Escape" && setAddingTag(false))}
                onBlur={addTag}
                className="h-6 w-28 px-2 bg-surface-container-lowest border border-secondary rounded font-mono text-code-sm focus:outline-none"
                placeholder="tag"
              />
            ) : (
              <button type="button" onClick={() => setAddingTag(true)} className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container font-mono text-code-sm hover:bg-surface-container-high">
                <Icon name="add" className="text-[0.875rem]" /> Add tag
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="label-caps text-on-surface-variant">Assigned collections</span>
          <div className="flex flex-wrap gap-1.5 items-center">
            {assigned.map((c) => (
              <Chip
                key={c.id}
                tone="secondary"
                onRemove={c.githubListId ? undefined : () => attempt(() => setMembership(c.id, repo.fullName, false))}
              >
                <Icon name={c.icon} className="text-[0.875rem]" />
                <Link to={`/collections/${c.id}`}>{c.name}</Link>
                {c.githubListId && <GitHubListBadge isPrivate={c.isPrivate} />}
              </Chip>
            ))}
            <AssignMenu
              fullName={repo.fullName}
              align="left"
              trigger={(toggle) => (
                <button type="button" onClick={toggle} className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container font-mono text-code-sm hover:bg-surface-container-high">
                  <Icon name="create_new_folder" className="text-[0.875rem]" /> Assign
                </button>
              )}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function ReadmeTab({ repo }: { repo: Repo }) {
  const { data, error, loading } = useGitHubResource(`readme:${repo.fullName}`, () => fetchReadme(repo.fullName));
  if (loading) return <Loading label="Fetching README" />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return <EmptyState icon="description" title="No README" />;
  return (
    <>
      <div className="flex items-center justify-between mb-4 font-mono text-code-sm text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <Icon name="menu_book" className="text-[1rem]" /> README.md preview (GitHub Flavored Markdown)
        </span>
        <span>{(new Blob([data]).size / 1024).toFixed(1)} KB</span>
      </div>
      <Markdown source={data} fullName={repo.fullName} branch={repo.defaultBranch} />
    </>
  );
}

function ReleasesTab({ repo }: { repo: Repo }) {
  const { data, error, loading } = useGitHubResource(`releases:${repo.fullName}`, () => fetchReleases(repo.fullName));
  if (loading) return <Loading label="Fetching releases" />;
  if (error) return <ErrorNote message={error} />;
  if (!data?.length) return <EmptyState icon="new_releases" title="No releases published" />;
  return (
    <ol className="flex flex-col gap-4">
      {data.map((r) => (
        <li key={r.id} className="border border-surface-container-highest rounded-lg p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-headline-sm hover:text-secondary">
              {r.name}
              <span className="px-1.5 py-0.5 rounded bg-surface-container-high font-mono text-code-sm text-primary">{r.tagName}</span>
              {r.prerelease && <span className="font-mono text-code-sm text-advisory">pre-release</span>}
            </a>
            <span className="font-mono text-code-sm text-on-surface-variant">{shortDate(r.publishedAt)}</span>
          </div>
          {r.body && (
            <details>
              <summary className="cursor-pointer font-mono text-code-sm text-secondary">Changelog</summary>
              <div className="mt-3">
                <Markdown source={r.body} fullName={repo.fullName} branch={repo.defaultBranch} />
              </div>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

function ContributorsTab({ repo }: { repo: Repo }) {
  const { data, error, loading } = useGitHubResource(`contributors:${repo.fullName}`, () => fetchContributors(repo.fullName));
  if (loading) return <Loading label="Fetching contributors" />;
  if (error) return <ErrorNote message={error} />;
  if (!data?.length) return <EmptyState icon="group" title="No contributor data" />;
  const max = data[0].contributions;
  return (
    <ul className="grid sm:grid-cols-2 gap-2">
      {data.map((c) => (
        <li key={c.login}>
          <a href={c.htmlUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-2 rounded hover:bg-surface-container">
            <img src={c.avatarUrl} alt="" className="w-8 h-8 rounded-full" loading="lazy" />
            <span className="flex-1 min-w-0">
              <span className="block truncate">{c.login}</span>
              <span className="block h-1 mt-1 bg-surface-container-highest rounded-full overflow-hidden">
                <span className="block h-full bg-tertiary-container" style={{ width: `${(c.contributions / max) * 100}%` }} />
              </span>
            </span>
            <span className="font-mono text-code-sm text-on-surface-variant">{fullNumber(c.contributions)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function SimilarTab({ similar }: { similar: Repo[] }) {
  if (!similar.length) return <EmptyState icon="hub" title="No similar stars">Nothing else in your vault shares topics with this repo.</EmptyState>;
  return (
    <ul className="grid sm:grid-cols-2 gap-3">
      {similar.map((r) => (
        <li key={r.fullName}>
          <Link to={repoPath(r)} className="block p-4 border border-surface-container-highest rounded-lg hover:border-secondary/40">
            <p className="flex items-center justify-between gap-2">
              <span className="text-secondary truncate">{r.fullName}</span>
              <span className="font-mono text-code-sm text-primary">★ {compactNumber(r.stars)}</span>
            </p>
            <p className="text-body-sm text-on-surface-variant line-clamp-2 mt-1">{r.description}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const Loading = ({ label }: { label: string }) => (
  <p className="flex items-center gap-2 py-10 justify-center font-mono text-code-sm text-on-surface-variant">
    <Icon name="progress_activity" className="animate-spin text-primary" /> {label}…
  </p>
);
const ErrorNote = ({ message }: { message: string }) => (
  <p className="flex items-center gap-2 p-3 rounded bg-error-container/30 text-error font-mono text-code-sm">
    <Icon name="error" /> {message}
  </p>
);

export function RepoPage() {
  const { owner, name } = useParams();
  const fullName = `${owner}/${name}`;
  const repos = useRepos();
  const [tab, setTab] = useState<Tab>("readme");
  const [copied, setCopied] = useState(false);
  const repo = repos?.find((r) => r.fullName === fullName);

  useEffect(() => {
    setTab("readme");
  }, [fullName]);

  const similar = useMemo(() => {
    if (!repo || !repos) return [];
    const topics = new Set(repo.topics);
    return repos
      .filter((r) => r.fullName !== repo.fullName)
      .map((r) => ({ r, score: r.topics.filter((t) => topics.has(t)).length + (r.language === repo.language ? 0.5 : 0) }))
      .filter((x) => x.score >= 1)
      .sort((a, b) => b.score - a.score || b.r.stars - a.r.stars)
      .slice(0, 8)
      .map((x) => x.r);
  }, [repo, repos]);

  if (!repos) return null;
  if (!repo) {
    return (
      <EmptyState icon="travel_explore" title="Not in your vault">
        <a className="text-secondary hover:underline" href={`https://github.com/${fullName}`} target="_blank" rel="noreferrer">
          Open {fullName} on GitHub
        </a>
      </EmptyState>
    );
  }

  const tabs: { key: Tab; label: string; icon: string; badge?: string }[] = [
    { key: "readme", label: "README.md", icon: "description" },
    { key: "releases", label: "Releases & Changelog", icon: "new_releases" },
    { key: "contributors", label: "Contributors", icon: "group" },
    { key: "similar", label: "Similar Stars", icon: "auto_awesome", badge: String(similar.length) },
  ];

  return (
    <div className="flex gap-6">
      <ActiveFeed repos={repos} current={repo.fullName} />
      <div className="flex-1 min-w-0 flex flex-col gap-5">
        <Card className="p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="folder_open" className="text-secondary text-[1.5rem]" />
            <h1 className="text-headline-lg">
              <span className="text-on-surface-variant font-normal">{repo.owner}</span>
              <span className="text-on-surface-variant/50 mx-1">/</span>
              <span>{repo.name}</span>
            </h1>
            <span className="px-1.5 py-0.5 rounded border border-surface-container-highest font-mono text-[0.625rem] uppercase tracking-wider text-on-surface-variant">
              {repo.archived ? "Archived" : repo.isPrivate ? "Private" : "Public"}
            </span>
            {repo.language && (
              <span className="flex items-center gap-1.5 font-mono text-code-sm ml-2">
                <LanguageDot language={repo.language} /> {repo.language}
              </span>
            )}
          </div>
          {repo.description && <p className="text-body-lg text-on-surface/90">{repo.description}</p>}
          <div className="flex flex-wrap gap-2">
            <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
              <Button icon="open_in_new">Open in GitHub</Button>
            </a>
            {repo.homepage && /^https?:\/\//i.test(repo.homepage) && (
              <a href={repo.homepage} target="_blank" rel="noreferrer">
                <Button icon="language">Homepage</Button>
              </a>
            )}
            <Button
              icon={copied ? "check" : "content_copy"}
              onClick={async () => {
                await navigator.clipboard.writeText(`git clone ${repo.htmlUrl}.git`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "Copied" : "Copy Clone"}
            </Button>
            <a href={repo.htmlUrl} target="_blank" rel="noreferrer" title="Star or unstar on GitHub">
              <Button variant="primary" icon="star">
                Starred ({compactNumber(repo.stars)})
              </Button>
            </a>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Stars count" value={repo.stars} tone="text-primary" />
            <Stat label="Forks" value={repo.forks} />
            <Stat label="Watchers" value={repo.watchers} />
            <Stat label="Open issues" value={repo.openIssues} tone="text-secondary" />
          </div>
          {repo.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {repo.topics.map((t) => (
                <Link key={t} to={`/?tag=${encodeURIComponent(t)}`}>
                  <Chip>#{t}</Chip>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <WorkspaceMeta repo={repo} />

        <Card className="overflow-hidden">
          <div role="tablist" className="flex overflow-x-auto border-b border-surface-container-highest bg-surface-container-low">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cx(
                  "flex items-center gap-2 px-4 py-3 whitespace-nowrap border-b-2 transition-colors",
                  tab === t.key ? "border-primary text-primary bg-surface-container" : "border-transparent text-on-surface-variant hover:text-on-surface",
                )}
              >
                <Icon name={t.icon} className="text-[1.125rem]" />
                {t.label}
                {t.badge && <span className="px-1.5 rounded bg-primary-container/20 text-primary font-mono text-code-sm">{t.badge}</span>}
              </button>
            ))}
          </div>
          <div className="p-5">
            {tab === "readme" && <ReadmeTab repo={repo} />}
            {tab === "releases" && <ReleasesTab repo={repo} />}
            {tab === "contributors" && <ContributorsTab repo={repo} />}
            {tab === "similar" && <SimilarTab similar={similar} />}
          </div>
        </Card>
      </div>
    </div>
  );
}
