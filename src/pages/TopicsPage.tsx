import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Card, cx, inputClass, PageHeader } from "../components/ui";
import { useMetaMap, useRepos } from "../hooks/useVault";
import { topTopics } from "../lib/stats";

export function TopicsPage() {
  const loaded = useRepos();
  const repos = loaded ?? [];
  const meta = useMetaMap();
  const [q, setQ] = useState("");
  const topics = useMemo(() => topTopics(repos, Infinity), [repos]);
  const userTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of meta.values()) for (const t of m.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }, [meta]);
  const needle = q.toLowerCase();
  const shown = topics.filter((t) => t.topic.includes(needle));
  const max = topics[0]?.count ?? 1;

  if (!loaded) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Taxonomy" title="Topics & Tags">
        {topics.length} GitHub topics and {userTags.length} custom tags across your vault.
      </PageHeader>
      {userTags.length > 0 && (
        <Card className="p-5">
          <h2 className="label-caps text-on-surface-variant mb-3">Your custom tags</h2>
          <div className="flex flex-wrap gap-2">
            {userTags.map((t) => (
              <Link key={t.tag} to={`/?tag=${encodeURIComponent(t.tag)}`} className="px-2 py-1 rounded bg-primary-container/15 text-primary font-mono text-code-sm hover:bg-primary-container/25">
                #{t.tag} <span className="opacity-70">{t.count}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="label-caps text-on-surface-variant">GitHub topics</h2>
          <input className={cx(inputClass, "max-w-xs h-8")} placeholder="Filter topics…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        </div>
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-x-6 gap-y-1">
          {shown.map((t) => (
            <li key={t.topic}>
              <Link to={`/?tag=${encodeURIComponent(t.topic)}`} className="group flex items-center gap-3 py-1.5">
                <span className="font-mono text-code-sm text-secondary group-hover:underline truncate w-40">#{t.topic}</span>
                <span className="flex-1 h-1.5 rounded-full bg-surface-container">
                  <span className="block h-full rounded-full bg-primary-container/70" style={{ width: `${(t.count / max) * 100}%` }} />
                </span>
                <span className="font-mono text-code-sm text-on-surface-variant w-8 text-right">{t.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
