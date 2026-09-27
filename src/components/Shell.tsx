import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router";
import { useSync } from "../hooks/SyncContext";
import { useCollections, useRepos, useSettings } from "../hooks/useVault";
import { fullNumber } from "../lib/format";
import { languageCounts } from "../lib/stats";
import { CollectionDialog } from "./CollectionDialog";
import { SettingsDialog } from "./SettingsDialog";
import { cx, Icon, LanguageDot } from "./ui";

const navClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    "flex items-center justify-between gap-2 px-3 py-1.5 rounded border-l-2 transition-colors",
    isActive
      ? "bg-surface-container-high text-primary font-semibold border-primary"
      : "border-transparent text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
  );

function Header({ onMenu }: { onMenu: () => void }) {
  const repos = useRepos();
  const settings = useSettings();
  const { running, fetched, sync, setSettingsOpen, error } = useSync();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onSearch(value: string) {
    setQ(value);
    // Search filters the current star list when on one, otherwise jumps to All Stars.
    const listPage = /^\/($|recent|lang\/|collections\/.+)/.test(location.pathname);
    const next = new URLSearchParams(listPage ? params : undefined);
    if (value) next.set("q", value);
    else next.delete("q");
    navigate({ pathname: listPage ? location.pathname : "/", search: next.toString() }, { replace: listPage });
  }

  return (
    <header className="fixed top-0 inset-x-0 h-16 z-40 bg-surface-container-low/95 backdrop-blur-md border-b border-surface-container-highest flex items-center gap-3 px-4 lg:px-8">
      <button type="button" className="lg:hidden text-on-surface-variant" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" />
      </button>
      <NavLink to="/" className="flex items-center gap-3 lg:w-64 shrink-0">
        <img src="/logo.svg" alt="" className="h-8 w-8" />
        <span className="text-headline-sm text-primary font-bold tracking-tight hidden sm:inline">StarVault</span>
      </NavLink>
      <div className="flex-1 max-w-xl mx-auto relative flex items-center">
        <Icon name="search" className="absolute left-3 text-on-surface-variant text-[1.125rem] pointer-events-none" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (onSearch(""), inputRef.current?.blur())}
          className="w-full h-9 pl-10 pr-16 bg-surface-container-lowest border border-surface-container-highest rounded placeholder:text-on-surface-variant/60 focus:outline-none focus:border-secondary focus:shadow-[0_0_0_3px_rgba(88,166,255,0.2)] transition-colors"
          placeholder="Search stars, topics, notes…"
          type="search"
        />
        <div className="absolute right-2 hidden sm:flex items-center gap-1 pointer-events-none">
          <kbd className="px-1.5 py-0.5 bg-surface-container border border-surface-container-highest rounded font-mono text-code-sm text-on-surface-variant">⌘</kbd>
          <kbd className="px-1.5 py-0.5 bg-surface-container border border-surface-container-highest rounded font-mono text-code-sm text-on-surface-variant">K</kbd>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden xl:flex items-center gap-1 px-2 py-1 bg-surface-container border border-surface-container-highest rounded-full">
          <Icon name="star" className="text-primary text-[1rem]" />
          <span className="font-mono text-code-sm">
            {running ? `${fullNumber(fetched)} fetched…` : `${fullNumber(repos?.length ?? 0)} ${settings.lastSyncedAt ? "stars synced" : "demo stars"}`}
          </span>
        </div>
        <button
          type="button"
          onClick={sync}
          disabled={running}
          title={error ?? "Sync stars from GitHub"}
          className={cx(
            "flex items-center gap-1 px-3 py-1.5 bg-surface-container border rounded transition-colors hover:border-primary-container hover:text-primary",
            error ? "border-error text-error" : "border-surface-container-highest",
          )}
        >
          <Icon name={error ? "sync_problem" : "sync"} className={cx("text-[1rem]", running && "animate-spin")} />
          <span className="label-caps hidden sm:inline">{running ? "Syncing" : "Sync"}</span>
        </button>
        {settings.username && settings.lastSyncedAt && (
          <NavLink
            to={`/u/${encodeURIComponent(settings.username)}`}
            title="Your public profile — share this link"
            className="hidden sm:flex p-1.5 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
          >
            <Icon name="share" className="text-[1.25rem]" />
          </NavLink>
        )}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center pl-2 border-l border-surface-container-highest"
          aria-label="Settings"
          title="Account & backup"
        >
          {settings.avatarUrl ? (
            <img src={settings.avatarUrl} alt="" className="w-8 h-8 rounded-full ring-1 ring-surface-container-highest" />
          ) : (
            <span className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface">
              <Icon name="settings" className="text-[1.125rem]" />
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const repos = useRepos() ?? [];
  const settings = useSettings();
  const { collections, members } = useCollections();
  const { error } = useSync();
  const langs = useMemo(() => languageCounts(repos).slice(0, 6), [repos]);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(onClose, [location.pathname]); // close the mobile drawer on navigation

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={onClose} />}
      <aside
        className={cx(
          "fixed left-0 top-16 bottom-0 w-72 z-30 bg-surface-container-low border-r border-surface-container-highest flex flex-col justify-between overflow-y-auto transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="p-3 flex flex-col gap-5">
          <nav className="flex flex-col gap-1">
            <NavLink to="/" end className={navClass}>
              <span className="flex items-center gap-2">
                <Icon name="stars" className="text-[1.125rem]" />
                All Stars
              </span>
            </NavLink>
            <NavLink to="/recent" className={navClass}>
              <span className="flex items-center gap-2">
                <Icon name="update" className="text-[1.125rem]" />
                Recently Updated
              </span>
            </NavLink>
            <NavLink to="/analytics" className={navClass}>
              <span className="flex items-center gap-2">
                <Icon name="monitoring" className="text-[1.125rem]" />
                Analytics
              </span>
            </NavLink>
          </nav>

          <div>
            <div className="flex items-center justify-between px-3 mb-1 label-caps text-on-surface-variant">
              <NavLink to="/collections" end className={({ isActive }) => cx("hover:text-on-surface", isActive && "text-primary")}>
                Collections
              </NavLink>
              <button type="button" onClick={() => setCreating(true)} aria-label="New collection" className="hover:text-on-surface">
                <Icon name="add" className="text-[0.875rem]" />
              </button>
            </div>
            <nav className="flex flex-col gap-0.5">
              {collections.map((c) => (
                <NavLink key={c.id} to={`/collections/${c.id}`} className={navClass}>
                  <span className="flex items-center gap-2 text-body-sm min-w-0">
                    <Icon name={c.icon} className="text-[1rem]" />
                    <span className="truncate">{c.name}</span>
                    {c.githubListId && <Icon name={c.isPrivate ? "lock" : "cloud_sync"} className="text-[0.75rem] opacity-60" />}
                  </span>
                  <span className="font-mono text-code-sm opacity-70">{members.get(c.id)?.size ?? 0}</span>
                </NavLink>
              ))}
              {collections.length === 0 && <p className="px-3 text-body-sm text-on-surface-variant/60">No collections yet.</p>}
            </nav>
          </div>

          <div>
            <div className="px-3 mb-1 label-caps text-on-surface-variant">Languages</div>
            <nav className="flex flex-col gap-0.5">
              {langs.map(({ language, count }) => (
                <NavLink key={language} to={`/lang/${encodeURIComponent(language)}`} className={navClass}>
                  <span className="flex items-center gap-2 text-body-sm">
                    <LanguageDot language={language} />
                    {language}
                  </span>
                  <span className="font-mono text-code-sm opacity-70">{count}</span>
                </NavLink>
              ))}
            </nav>
          </div>

          <nav>
            <NavLink to="/topics" className={navClass}>
              <span className="flex items-center gap-2">
                <Icon name="sell" className="text-[1.125rem]" />
                Topics / Tags
              </span>
            </NavLink>
          </nav>
        </div>

        <div className="p-3 border-t border-surface-container-highest flex items-center justify-between text-on-surface-variant font-mono text-code-sm">
          <span className="flex items-center gap-1.5" title={error ?? undefined}>
            <span className={cx("w-2 h-2 rounded-full", error ? "bg-error" : "bg-primary animate-pulse")} />
            {error ? "Sync failed" : settings.lastSyncedAt ? "Engine Ready" : "Demo Mode"}
          </span>
          <span className="opacity-50">v0.1.0</span>
        </div>
      </aside>
      <CollectionDialog open={creating} onClose={() => setCreating(false)} onSaved={(c) => navigate(`/collections/${c.id}`)} />
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <Header onMenu={() => setMenuOpen(true)} />
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="lg:pl-72">
        <main className="relative pt-16 min-h-screen">
          <div className="px-4 lg:px-6 py-6 max-w-[1600px] mx-auto">{children}</div>
        </main>
      </div>
      <SettingsDialog />
    </>
  );
}
