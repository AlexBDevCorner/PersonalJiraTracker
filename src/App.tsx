import { Route, Routes } from "react-router-dom";
import { AppLayout, ErrorBanner, ErrorBoundary, Loading } from "./ui";
import { TimesheetPage } from "./features/timesheet/TimesheetPage";
import { FavoritesPage } from "./features/favorites/FavoritesPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { useDbReady } from "./db";

function App() {
  const { state, retry } = useDbReady();

  if (state.status === "loading") {
    return <Loading label="Preparing local database..." />;
  }

  if (state.status === "error") {
    return (
      <ErrorBanner
        title="Could not open local database"
        message={state.message}
        onRetry={retry}
      />
    );
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<AppLayout />}>
          <Route
            index
            element={
              <ErrorBoundary>
                <TimesheetPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="favorites"
            element={
              <ErrorBoundary>
                <FavoritesPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="settings"
            element={
              <ErrorBoundary>
                <SettingsPage />
              </ErrorBoundary>
            }
          />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
