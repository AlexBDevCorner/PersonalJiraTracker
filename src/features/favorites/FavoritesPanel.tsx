import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckIcon, IssueKeyLink, PencilIcon, PlusIcon } from "../../ui";
import {
  listAllFavoriteIssues,
  listFavoriteGroups,
  type FavoriteGroup,
  type FavoriteIssue,
} from "./favoritesRepo";
import "./FavoritesPanel.css";

type Props = {
  reloadKey: number;
  weekIssueKeys: ReadonlySet<string>;
  onAdd: (issueKey: string) => void | Promise<void>;
};

export function FavoritesPanel({ reloadKey, weekIssueKeys, onAdd }: Props) {
  const [groups, setGroups] = useState<FavoriteGroup[]>([]);
  const [favorites, setFavorites] = useState<FavoriteIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listFavoriteGroups(), listAllFavoriteIssues()])
      .then(([loadedGroups, loadedFavorites]) => {
        if (cancelled) return;
        setGroups(loadedGroups);
        setFavorites(loadedFavorites);
        setError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : "Failed to load favorites.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleAdd = async (issueKey: string) => {
    setBusyKey(issueKey);
    try {
      await onAdd(issueKey);
    } finally {
      setBusyKey(null);
    }
  };

  const byGroup = groups.map((group) => ({
    group,
    issues: favorites.filter((issue) => issue.groupId === group.id),
  }));
  const ungrouped = favorites.filter((issue) => issue.groupId === null);

  return (
    <aside className="favorites-panel" aria-label="Favorites">
      <div className="favorites-panel__head">
        <h2 className="favorites-panel__title">Favorites</h2>
        <Link
          to="/favorites"
          className="favorites-panel__manage"
          aria-label="Manage favorites"
          title="Manage favorites"
        >
          <PencilIcon size={14} />
        </Link>
      </div>

      {error && (
        <p className="favorites-panel__error" role="alert">
          {error}
        </p>
      )}

      {!error && favorites.length === 0 && (
        <p className="favorites-panel__empty">
          No favorites yet. Star a ticket on the right or{" "}
          <Link to="/favorites">manage groups</Link>.
        </p>
      )}

      <div className="favorites-panel__groups">
        {byGroup.map(({ group, issues }) => {
          if (issues.length === 0) return null;
          return (
            <FavoriteGroupSection
              key={group.id}
              name={group.name}
              issues={issues}
              weekIssueKeys={weekIssueKeys}
              busyKey={busyKey}
              onAdd={handleAdd}
            />
          );
        })}
        {ungrouped.length > 0 && (
          <FavoriteGroupSection
            key="__ungrouped"
            name="Ungrouped"
            issues={ungrouped}
            weekIssueKeys={weekIssueKeys}
            busyKey={busyKey}
            onAdd={handleAdd}
          />
        )}
      </div>
    </aside>
  );
}

type SectionProps = {
  name: string;
  issues: FavoriteIssue[];
  weekIssueKeys: ReadonlySet<string>;
  busyKey: string | null;
  onAdd: (issueKey: string) => void | Promise<void>;
};

function FavoriteGroupSection({
  name,
  issues,
  weekIssueKeys,
  busyKey,
  onAdd,
}: SectionProps) {
  return (
    <section className="favorites-panel__group">
      <h3 className="favorites-panel__group-name">{name}</h3>
      <ul className="favorites-panel__list">
        {issues.map((issue) => {
          const onWeek = weekIssueKeys.has(issue.issueKey);
          const busy = busyKey === issue.issueKey;
          return (
            <li className="favorites-panel__item" key={issue.id}>
              <div className="favorites-panel__btn">
                <button
                  type="button"
                  className="favorites-panel__add"
                  onClick={() => void onAdd(issue.issueKey)}
                  disabled={onWeek || busy}
                  aria-label={
                    onWeek
                      ? `${issue.issueKey} already in this week`
                      : `Add ${issue.issueKey} to this week`
                  }
                  title={
                    onWeek
                      ? "Already in this week"
                      : `Add ${issue.issueKey} to this week`
                  }
                >
                  <span className="favorites-panel__icon" aria-hidden="true">
                    {onWeek ? <CheckIcon size={12} /> : <PlusIcon size={12} />}
                  </span>
                </button>
                <IssueKeyLink
                  issueKey={issue.issueKey}
                  className="favorites-panel__key"
                />
                <span
                  className="favorites-panel__summary"
                  title={issue.summary ?? undefined}
                >
                  {issue.summary ?? "(no summary)"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
