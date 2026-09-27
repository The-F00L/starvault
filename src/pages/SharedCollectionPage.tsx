import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { PublicRepoCard } from "../components/PublicRepoCard";
import { Button, EmptyState, Icon } from "../components/ui";
import { useToast } from "../hooks/Toast";
import { useRepos } from "../hooks/useVault";
import { assignMany, createCollection } from "../lib/collections";
import { compactNumber } from "../lib/format";
import { decodeCollection, type SharedCollection } from "../lib/share";

/** Renders a collection shared via /shared#<payload>. The payload never leaves the browser. */
export function SharedCollectionPage() {
  const [state, setState] = useState<{ data?: SharedCollection; error?: string }>({});
  const repos = useRepos();
  const navigate = useNavigate();
  const { attempt } = useToast();
  const inVault = useMemo(() => new Set(repos?.map((r) => r.fullName)), [repos]);

  useEffect(() => {
    const load = () =>
      decodeCollection(location.hash.slice(1)).then(
        (data) => setState({ data }),
        (e) => setState({ error: e instanceof Error ? e.message : String(e) }),
      );
    load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, []);

  if (state.error) return <EmptyState icon="link_off" title="Invalid share link">{state.error}</EmptyState>;
  const c = state.data;
  if (!c) return null;
  const owned = c.repos.filter((r) => inVault.has(r.fullName));

  async function save() {
    if (!c) return;
    let id = "";
    const ok = await attempt(async () => {
      const created = await createCollection({ name: c.name, description: c.description, icon: c.icon });
      id = created.id;
      await assignMany(owned.map((r) => ({ collectionId: created.id, fullName: r.fullName, member: true })));
    }, `Saved “${c.name}” with ${owned.length} of ${c.repos.length} repos from your stars`);
    if (ok) navigate(`/collections/${id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-lg bg-surface-container-high flex items-center justify-center text-primary shrink-0">
            <Icon name={c.icon} className="text-[1.5rem]" />
          </span>
          <div>
            <p className="label-caps text-primary">Shared collection</p>
            <h1 className="text-headline-lg">{c.name}</h1>
            {c.description && <p className="text-on-surface-variant max-w-2xl">{c.description}</p>}
            <p className="font-mono text-code-sm text-on-surface-variant mt-1">
              {c.repos.length} repositories · {compactNumber(c.repos.reduce((s, r) => s + r.stars, 0))} stars pooled
            </p>
          </div>
        </div>
        <Button variant="primary" icon="bookmark_add" onClick={save} disabled={owned.length === 0} title={owned.length ? undefined : "None of these repos are in your stars yet"}>
          Save to my vault ({owned.length} of {c.repos.length} starred)
        </Button>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {c.repos.map((r) => (
          <PublicRepoCard key={r.fullName} {...r} inVault={inVault.has(r.fullName)} />
        ))}
      </div>
    </div>
  );
}
