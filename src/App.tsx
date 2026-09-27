import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Shell } from "./components/Shell";
import { EmptyState } from "./components/ui";
import { SyncProvider } from "./hooks/SyncContext";
import { ToastProvider } from "./hooks/Toast";
import { seedDemoIfEmpty } from "./lib/mock";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { StarsPage } from "./pages/StarsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SharedCollectionPage } from "./pages/SharedCollectionPage";
import { TopicsPage } from "./pages/TopicsPage";

// The README renderer (markdown + sanitizer) is the heaviest dependency; load it on demand.
const RepoPage = lazy(() => import("./pages/RepoPage").then((m) => ({ default: m.RepoPage })));

export function App() {
  useEffect(() => {
    seedDemoIfEmpty();
  }, []);

  return (
    <BrowserRouter>
      <ToastProvider>
      <SyncProvider>
        <Shell>
          <RouteBoundary>
          <Routes>
            <Route path="/" element={<StarsPage key="all" mode="all" />} />
            <Route path="/recent" element={<StarsPage key="recent" mode="recent" />} />
            <Route path="/lang/:lang" element={<StarsPage key="lang" mode="language" />} />
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/collections/:id" element={<StarsPage key="collection" mode="collection" />} />
            <Route path="/repo/:owner/:name" element={<Suspense><RepoPage /></Suspense>} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/topics" element={<TopicsPage />} />
            <Route path="/u/:username" element={<ProfilePage />} />
            <Route path="/shared" element={<SharedCollectionPage />} />
            <Route path="*" element={<EmptyState icon="explore_off" title="Page not found" />} />
          </Routes>
          </RouteBoundary>
        </Shell>
      </SyncProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

function RouteBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}
