import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckIcon, PlusIcon, StarIcon } from "../../ui";
import { ensureIssueStub } from "../issues";
import { getSettings } from "../settings/settingsRepo";
import { log } from "../../log";
import { scanGitCommits } from "./api";
import { getAuthorEmails } from "./authorEmailsRepo";
import { listScanRoots } from "./scanRootsRepo";
import type { GitCommitRecord, GitScanResult } from "./types";
import "./GitCommitsPanel.css";

type Props = {
  weekStartIso: string;
  weekEndIso: string;
  selectedDateIso: string;
  reloadKey: number;
  weekIssueKeys: ReadonlySet<string>;
  favoriteKeys: ReadonlySet<string>;
  onAddToWeek: (issueKey: string) => void | Promise<void>;
  onToggleFavorite: (issueKey: string) => void | Promise<void>;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "no-roots" }
  | { kind: "no-emails" }
  | { kind: "loading" }
  | { kind: "ready"; result: GitScanResult }
  | { kind: "error"; message: string };

type TicketGroup = {
  key: string;
  commits: GitCommitRecord[];
  repos: Set<string>;
};

function groupByTicket(commits: GitCommitRecord[]): TicketGroup[] {
  const map = new Map<string, TicketGroup>();
  for (const commit of commits) {
    for (const key of commit.ticketKeys) {
      let group = map.get(key);
      if (!group) {
        group = { key, commits: [], repos: new Set() };
        map.set(key, group);
      }
      group.commits.push(commit);
      group.repos.add(commit.repoName || commit.repoPath);
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function GitCommitsPanel({
  weekStartIso,
  weekEndIso,
  selectedDateIso,
  reloadKey,
  weekIssueKeys,
  favoriteKeys,
  onAddToWeek,
  onToggleFavorite,
}: Props) {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [favBusyKey, setFavBusyKey] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setExpanded(new Set());
    (async () => {
      try {
        const [roots, configuredEmails, settings] = await Promise.all([
          listScanRoots(),
          getAuthorEmails(),
          getSettings(),
        ]);
        if (cancelled) return;
        if (roots.length === 0) {
          setState({ kind: "no-roots" });
          return;
        }
        const emails =
          configuredEmails.length > 0
            ? configuredEmails
            : settings.email
              ? [settings.email.toLowerCase()]
              : [];
        if (emails.length === 0) {
          setState({ kind: "no-emails" });
          return;
        }
        const result = await scanGitCommits({
          roots: roots.map((r) => r.path),
          authorEmails: emails,
          startIso: weekStartIso,
          endIso: weekEndIso,
        });
        if (cancelled) return;
        setState({ kind: "ready", result });
      } catch (cause) {
        if (cancelled) return;
        log.error("Git scan failed", cause);
        setState({
          kind: "error",
          message:
            cause instanceof Error ? cause.message : "Git scan failed.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekStartIso, weekEndIso, reloadKey, refreshNonce]);

  const dayCommits = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.result.commits.filter((c) => c.dateIso === selectedDateIso);
  }, [state, selectedDateIso]);

  const groups = useMemo(() => groupByTicket(dayCommits), [dayCommits]);

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleAdd = async (issueKey: string) => {
    setBusyKey(issueKey);
    try {
      await ensureIssueStub(issueKey);
      await onAddToWeek(issueKey);
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleFavorite = async (issueKey: string) => {
    setFavBusyKey(issueKey);
    try {
      await ensureIssueStub(issueKey);
      await onToggleFavorite(issueKey);
    } finally {
      setFavBusyKey(null);
    }
  };

  return (
    <section className="git-commits" aria-label="Git commits">
      <div className="git-commits__head">
        <h2 className="git-commits__title">Git commits</h2>
        <div className="git-commits__head-right">
          <span className="git-commits__date">{selectedDateIso}</span>
          <button
            type="button"
            className="git-commits__refresh"
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={state.kind === "loading"}
            aria-label="Rescan repositories"
            title="Rescan repositories"
          >
            <span
              className={
                "git-commits__refresh-icon" +
                (state.kind === "loading" ? " is-spinning" : "")
              }
              aria-hidden="true"
            >
              ↻
            </span>
          </button>
        </div>
      </div>

      {state.kind === "loading" && (
        <p className="git-commits__meta">Scanning repositories…</p>
      )}

      {state.kind === "no-roots" && (
        <p className="git-commits__meta">
          No folders configured.{" "}
          <Link className="git-commits__link" to="/settings">
            Add Git folders in Settings
          </Link>
          .
        </p>
      )}

      {state.kind === "no-emails" && (
        <p className="git-commits__meta">
          No author emails configured.{" "}
          <Link className="git-commits__link" to="/settings">
            Set Git author emails in Settings
          </Link>
          .
        </p>
      )}

      {state.kind === "error" && (
        <p className="git-commits__error" role="alert">
          {state.message}
        </p>
      )}

      {state.kind === "ready" && state.result.scannedRepos.length === 0 && (
        <p className="git-commits__meta">
          No Git repositories found in configured folders.
        </p>
      )}

      {state.kind === "ready" &&
        state.result.scannedRepos.length > 0 &&
        groups.length === 0 && (
          <p className="git-commits__meta">No ticket commits for this day.</p>
        )}

      {groups.length > 0 && (
        <ul className="git-commits__list">
          {groups.map((group) => {
            const onWeek = weekIssueKeys.has(group.key);
            const adding = busyKey === group.key;
            const isFavorite = favoriteKeys.has(group.key);
            const favBusy = favBusyKey === group.key;
            const isOpen = expanded.has(group.key);
            return (
              <li className="git-commits__item" key={group.key}>
                <div className="git-commits__row">
                  <button
                    type="button"
                    className={
                      "git-commits__star" +
                      (isFavorite ? " is-favorite" : "")
                    }
                    onClick={() => void handleToggleFavorite(group.key)}
                    disabled={favBusy}
                    aria-pressed={isFavorite}
                    aria-label={
                      isFavorite
                        ? `Unfavorite ${group.key}`
                        : `Favorite ${group.key}`
                    }
                    title={isFavorite ? "Unfavorite" : "Add to favorites"}
                  >
                    <StarIcon size={14} filled={isFavorite} />
                  </button>
                  <button
                    type="button"
                    className="git-commits__expand"
                    onClick={() => toggleExpanded(group.key)}
                    aria-expanded={isOpen}
                  >
                    <span className="git-commits__key">{group.key}</span>
                    <span className="git-commits__counts">
                      {group.commits.length}{" "}
                      {group.commits.length === 1 ? "commit" : "commits"}
                      {" · "}
                      {group.repos.size}{" "}
                      {group.repos.size === 1 ? "repo" : "repos"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-commits__add"
                    onClick={() => void handleAdd(group.key)}
                    disabled={onWeek || adding}
                    aria-label={
                      onWeek
                        ? `${group.key} already in this week`
                        : `Add ${group.key} to this week`
                    }
                    title={onWeek ? "Already in this week" : "Add to this week"}
                  >
                    {onWeek ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
                  </button>
                </div>
                {isOpen && (
                  <ul className="git-commits__commits">
                    {group.commits.map((commit) => (
                      <li
                        key={commit.hash}
                        className="git-commits__commit"
                      >
                        <div className="git-commits__commit-meta">
                          <code>{commit.hash.slice(0, 7)}</code>
                          <span>{commit.repoName || commit.repoPath}</span>
                          <span>
                            {commit.datetimeIso.slice(11, 16)}
                          </span>
                        </div>
                        <pre className="git-commits__commit-msg">
                          {commit.message}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {state.kind === "ready" && state.result.errors.length > 0 && (
        <details className="git-commits__errors">
          <summary>{state.result.errors.length} repos failed to scan</summary>
          <ul>
            {state.result.errors.map((err) => (
              <li key={err.repoPath}>
                <code>{err.repoPath}</code>: {err.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
