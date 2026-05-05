import { Link, Outlet, useLocation } from "react-router-dom";
import { CloseIcon, GearIcon } from "./Icons";
import "./AppLayout.css";

export function AppLayout() {
  const location = useLocation();
  const onSettings = location.pathname.startsWith("/settings");

  return (
    <div className="app-layout">
      <header className="app-header">
        <Link to="/" className="app-header__brand" aria-label="Jira Ticket Tracker home">
          <span className="app-header__brand-mark" aria-hidden="true">JT</span>
          <span className="app-header__brand-name">
            <span>Jira</span>
            <span className="app-header__brand-dot" aria-hidden="true">·</span>
            <span>Ticket Tracker</span>
          </span>
        </Link>
        <div className="app-header__actions">
          {onSettings ? (
            <Link
              to="/"
              className="app-header__icon-btn"
              aria-label="Close settings"
              title="Close settings"
            >
              <CloseIcon size={18} />
            </Link>
          ) : (
            <Link
              to="/settings"
              className="app-header__icon-btn"
              aria-label="Open settings"
              title="Settings"
            >
              <GearIcon size={18} />
            </Link>
          )}
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
