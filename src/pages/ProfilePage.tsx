import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { PublicRepoCard } from "../components/PublicRepoCard";
import { Button, Card, cx, EmptyState, Icon, inputClass } from "../components/ui";
import { useGitHubResource } from "../hooks/useGitHubResource";
import { useRepos, useSettings } from "../hooks/useVault";
import { fetchLists, fetchStarred, fetchUser } from "../lib/api";
import { fullNumber } from "../lib/format";
import { LOGIN } from "../lib/github";
import { filterRepos, languageCounts, sortRepos } from "../lib/stats";
import { Pager } from "./StarsPage";

const PAGE = 24;

/** Read-only public view of anyone's stars and GitHub Lists: /u/:username */
export function ProfilePage() {
  const { username = "" } = useParams();
  const valid = LOGIN.test(username);
  const me = useSettings();
  const mine = useRepos();
  const inVault = useMemo(() => new Set(mine?.map((r) => r.fullName)), [mine]);

  const user = useGitHubResource(valid ? `user:${username}` : null, () => fetchUser(username));
  const stars = useGitHubResource(valid ? `stars:${username}` : null, () => fetchStarred(username));
  const lists = useGitHubResource(valid ? `lists:${username}` : null, () => fetchLists(username));

  const [tab, setTab] = useState<"lists" | "stars">("lists");
  const [openList, setOpenList] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("");
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);

  const byName = useMemo(() => new Map(stars.data?.map((r) => [r.fullName, r])), [stars.data]);
  const filtered = useMemo(
    () => sortRepos(filterRepos(stars.data ?? [], new Map(), { q, language: lang || null }), "starred"),
    [stars.data, q, lang],
  );

  if (!valid) return <EmptyState icon="person_off" title="Not a valid GitHub username" />;
  if (user.error) return <EmptyState icon="person_off" title={`Couldn't load @${username}`}>{user.error}</EmptyState>;

  const isMe = me.username.toLowerCase() === username.toLowerCase();
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages);
  const effectiveTab = lists.data && lists.data.length === 0 ? "stars" : tab;

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        {user.data ? <img src={user.data.avatarUrl} alt="" className="w-16 h-16 rounded-full ring-1 ring-surface-container-highest" /> : <span className="w-16 h-16 rounded-full bg-surface-container-high animate-pulse" />}
        <div className="flex-1 min-w-0">
          <p className="label-caps text-primary">Public StarVault</p>
          <h1 className="text-headline-lg truncate">{user.data?.name || `@${username}`}</h1>
          <p className="font-mono text-code-sm text-on-surface-variant">
            @{username}
            {stars.data && ` · ${fullNumber(stars.data.length)} stars`}
            {lists.data && ` · ${lists.data.length} lists`}
          </p>
          {user.data?.bio && <p className="text-body-sm text-on-surface-variant mt-1">{user.data.bio}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={copied ? "check" : "share"}
            variant="accent"
            onClick={async () => {
              await navigator.clipboard.writeText(location.href.split("#")[0]);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <a href={`https://github.com/${username}?tab=stars`} target="_blank" rel="noreferrer">
            <Button icon="open_in_new">GitHub</Button>
          </a>
          {isMe && (
            <Link to="/">
              <Button icon="stars">My vault</Button>
            </Link>
          )}
        </div>
      </Card>

      <div role="tablist" className="flex gap-1 border-b border-surface-container-highest">
        {(["lists", "stars"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={effectiveTab === t}
            onClick={() => setTab(t)}
            className={cx("px-4 py-2 border-b-2 -mb-px", effectiveTab === t ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface")}
          >
            {t === "lists" ? `Lists${lists.data ? ` (${lists.data.length})` : ""}` : `Stars${stars.data ? ` (${fullNumber(stars.data.length)})` : ""}`}
          </button>
        ))}
      </div>

      {effectiveTab === "lists" &&
        (lists.loading ? (
          <Loading label="Loading GitHub Lists" />
        ) : lists.error ? (
          <EmptyState icon="list_alt" title="Lists unavailable">{lists.error}</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {lists.data!.map((l) => {
              const open = openList === l.id;
              return (
                <Card key={l.id} className="overflow-hidden">
                  <button type="button" onClick={() => setOpenList(open ? null : l.id)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-surface-container">
                    <Icon name="format_list_bulleted" className="text-secondary" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-headline-sm truncate">{l.name}</span>
                      {l.description && <span className="block text-body-sm text-on-surface-variant truncate">{l.description}</span>}
                    </span>
                    <span className="font-mono text-code-sm text-on-surface-variant">{l.repos.length} repos</span>
                    <Icon name={open ? "expand_less" : "expand_more"} className="text-on-surface-variant" />
                  </button>
                  {open && (
                    <div className="p-4 pt-0 grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {l.repos.map((name) => {
                        const r = byName.get(name);
                        return <PublicRepoCard key={name} fullName={name} description={r?.description ?? null} language={r?.language ?? null} stars={r?.stars ?? null} inVault={inVault.has(name)} />;
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        ))}

      {effectiveTab === "stars" &&
        (stars.loading ? (
          <Loading label="Loading stars" />
        ) : stars.error ? (
          <EmptyState icon="error" title="Couldn't load stars">{stars.error}</EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <input className={cx(inputClass, "max-w-xs h-8")} type="search" placeholder="Filter stars…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
              <select
                className="h-8 px-2 bg-surface-container border border-surface-container-highest rounded font-mono text-code-sm"
                value={lang}
                onChange={(e) => (setLang(e.target.value), setPage(1))}
                aria-label="Language"
              >
                <option value="">All languages</option>
                {languageCounts(stars.data!).map((l) => (
                  <option key={l.language} value={l.language}>
                    {l.language} ({l.count})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.slice((current - 1) * PAGE, current * PAGE).map((r) => (
                <PublicRepoCard key={r.fullName} fullName={r.fullName} description={r.description} language={r.language} stars={r.stars} inVault={inVault.has(r.fullName)} />
              ))}
            </div>
            {pages > 1 && (
              <div className="flex justify-end">
                <Pager current={current} pages={pages} onPage={setPage} />
              </div>
            )}
          </>
        ))}
    </div>
  );
}

const Loading = ({ label }: { label: string }) => (
  <p className="flex items-center gap-2 py-10 justify-center font-mono text-code-sm text-on-surface-variant">
    <Icon name="progress_activity" className="animate-spin text-primary" /> {label}…
  </p>
);
