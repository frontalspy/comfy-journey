import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { CreatePage } from "./pages/CreatePage";

// Everything except Create loads on demand, keeping the first screen small.
const LibraryPage = lazy(() => import("./pages/LibraryPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const WorkflowsPage = lazy(() => import("./pages/WorkflowsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

function PageFallback() {
  return (
    <div className="empty" role="status">
      <div className="spinner" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<CreatePage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <div className="empty">
                <h2>Page not found</h2>
              </div>
            }
          />
        </Route>
      </Routes>
    </Suspense>
  );
}
