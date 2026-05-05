import { useEffect, useState, type FormEvent } from "react";
import { ErrorBanner, IssueKeyLink, Loading } from "../../ui";
import {
  isValidIssueKey,
  JiraError,
  lookupJiraIssue,
  normalizeIssueKey,
} from "../../jira";
import { getCachedIssue, upsertIssue } from "../issues";
import {
  createFavoriteGroup,
  deleteFavoriteGroup,
  listFavoriteGroups,
  listFavoriteIssues,
  listUngroupedFavoriteIssues,
  moveFavoriteGroup,
  moveFavoriteIssueToGroup,
  pinIssueToGroup,
  renameFavoriteGroup,
  unpinFavoriteIssue,
  type FavoriteGroup,
  type FavoriteIssue,
} from "./favoritesRepo";
import "./FavoritesPage.css";

type LoadState =
  | { status: "loading" }
  | {
      status: "ready";
      groups: FavoriteGroup[];
      issuesByGroup: Record<number, FavoriteIssue[]>;
      ungrouped: FavoriteIssue[];
    }
  | { status: "error"; message: string };

type EditState = {
  id: number;
  value: string;
  error: string | null;
  saving: boolean;
};

type PinState = Record<number, { value: string; error: string | null; busy: boolean }>;

export function FavoritesPage() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [createValue, setCreateValue] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [busyGroupId, setBusyGroupId] = useState<number | null>(null);
  const [pinState, setPinState] = useState<PinState>({});
  const [issueError, setIssueError] = useState<{ id: number; message: string } | null>(null);
  const [busyIssueId, setBusyIssueId] = useState<number | null>(null);

  const refresh = async () => {
    try {
      const [groups, ungrouped] = await Promise.all([
        listFavoriteGroups(),
        listUngroupedFavoriteIssues(),
      ]);
      const entries = await Promise.all(
        groups.map(async (g) => [g.id, await listFavoriteIssues(g.id)] as const),
      );
      const issuesByGroup: Record<number, FavoriteIssue[]> = {};
      for (const [id, issues] of entries) issuesByGroup[id] = issues;
      setLoadState({ status: "ready", groups, issuesByGroup, ungrouped });
    } catch (cause) {
      setLoadState({
        status: "error",
        message: cause instanceof Error ? cause.message : "Failed to load favorite groups.",
      });
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [groups, ungrouped] = await Promise.all([
          listFavoriteGroups(),
          listUngroupedFavoriteIssues(),
        ]);
        const entries = await Promise.all(
          groups.map(async (g) => [g.id, await listFavoriteIssues(g.id)] as const),
        );
        if (cancelled) return;
        const issuesByGroup: Record<number, FavoriteIssue[]> = {};
        for (const [id, issues] of entries) issuesByGroup[id] = issues;
        setLoadState({ status: "ready", groups, issuesByGroup, ungrouped });
      } catch (cause) {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: cause instanceof Error ? cause.message : "Failed to load favorite groups.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadState.status === "loading") {
    return <Loading label="Loading favorites..." />;
  }

  if (loadState.status === "error") {
    return <ErrorBanner title="Could not load favorites" message={loadState.message} />;
  }

  const { groups, issuesByGroup, ungrouped } = loadState;

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = createValue.trim();
    if (!trimmed) {
      setCreateError("Enter a group name.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createFavoriteGroup(trimmed);
      setCreateValue("");
      await refresh();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Failed to create group.");
    } finally {
      setCreating(false);
    }
  };

  const startRename = (group: FavoriteGroup) => {
    setRowError(null);
    setEdit({ id: group.id, value: group.name, error: null, saving: false });
  };

  const cancelRename = () => setEdit(null);

  const submitRename = async () => {
    if (!edit) return;
    const trimmed = edit.value.trim();
    if (!trimmed) {
      setEdit({ ...edit, error: "Enter a group name." });
      return;
    }
    setEdit({ ...edit, saving: true, error: null });
    try {
      await renameFavoriteGroup(edit.id, trimmed);
      setEdit(null);
      await refresh();
    } catch (cause) {
      setEdit({
        ...edit,
        saving: false,
        error: cause instanceof Error ? cause.message : "Failed to rename group.",
      });
    }
  };

  const handleDelete = async (group: FavoriteGroup) => {
    setRowError(null);
    setBusyGroupId(group.id);
    try {
      await deleteFavoriteGroup(group.id);
      await refresh();
    } catch (cause) {
      setRowError({
        id: group.id,
        message: cause instanceof Error ? cause.message : "Failed to delete group.",
      });
    } finally {
      setBusyGroupId(null);
    }
  };

  const handleMove = async (group: FavoriteGroup, direction: "up" | "down") => {
    setRowError(null);
    setBusyGroupId(group.id);
    try {
      await moveFavoriteGroup(group.id, direction);
      await refresh();
    } catch (cause) {
      setRowError({
        id: group.id,
        message: cause instanceof Error ? cause.message : "Failed to reorder group.",
      });
    } finally {
      setBusyGroupId(null);
    }
  };

  const updatePin = (groupId: number, patch: Partial<PinState[number]>) => {
    setPinState((prev) => ({
      ...prev,
      [groupId]: {
        value: prev[groupId]?.value ?? "",
        error: prev[groupId]?.error ?? null,
        busy: prev[groupId]?.busy ?? false,
        ...patch,
      },
    }));
  };

  const handlePin = async (event: FormEvent<HTMLFormElement>, groupId: number) => {
    event.preventDefault();
    const raw = pinState[groupId]?.value ?? "";
    const trimmed = raw.trim();
    if (!trimmed) {
      updatePin(groupId, { error: "Enter an issue key, for example ABC-123." });
      return;
    }
    if (!isValidIssueKey(trimmed)) {
      updatePin(groupId, { error: "Issue key must look like ABC-123." });
      return;
    }
    const key = normalizeIssueKey(trimmed);
    updatePin(groupId, { busy: true, error: null });
    try {
      const cached = await getCachedIssue(key);
      if (!cached) {
        const fetched = await lookupJiraIssue(key);
        await upsertIssue(fetched);
      }
      await pinIssueToGroup(groupId, key);
      updatePin(groupId, { value: "", busy: false, error: null });
      await refresh();
    } catch (cause) {
      updatePin(groupId, { busy: false, error: formatPinError(cause) });
    }
  };

  const handleUnpin = async (issue: FavoriteIssue) => {
    setIssueError(null);
    setBusyIssueId(issue.id);
    try {
      await unpinFavoriteIssue(issue.id);
      await refresh();
    } catch (cause) {
      setIssueError({
        id: issue.id,
        message: cause instanceof Error ? cause.message : "Failed to remove issue.",
      });
    } finally {
      setBusyIssueId(null);
    }
  };

  const handleMoveIssue = async (
    issue: FavoriteIssue,
    newGroupId: number | null,
  ) => {
    if (newGroupId === issue.groupId) return;
    setIssueError(null);
    setBusyIssueId(issue.id);
    try {
      await moveFavoriteIssueToGroup(issue.id, newGroupId);
      await refresh();
    } catch (cause) {
      setIssueError({
        id: issue.id,
        message: cause instanceof Error ? cause.message : "Failed to move issue.",
      });
    } finally {
      setBusyIssueId(null);
    }
  };

  return (
    <section className="favorites-page">
      <h2>Favorites</h2>
      <p className="favorites-page__intro">
        Organize your favorite issues into groups such as Meetings, Features, or Internal.
      </p>

      <form className="favorites-create" onSubmit={handleCreate} noValidate>
        <div className="favorites-create__row">
          <input
            type="text"
            className={
              "favorites-create__input" + (createError ? " is-invalid" : "")
            }
            value={createValue}
            onChange={(event) => {
              setCreateValue(event.target.value);
              if (createError) setCreateError(null);
            }}
            placeholder="New group name"
            aria-label="New group name"
            aria-invalid={Boolean(createError)}
            autoComplete="off"
            spellCheck={false}
            disabled={creating}
          />
          <button
            type="submit"
            className="favorites-create__submit"
            disabled={creating || createValue.trim().length === 0}
          >
            {creating ? "Creating..." : "Create group"}
          </button>
        </div>
        {createError && (
          <span className="favorites-create__error" role="alert">
            {createError}
          </span>
        )}
      </form>

      {ungrouped.length > 0 && (
        <section className="favorites-group">
          <div className="favorites-group__header">
            <span className="favorites-group__name">Ungrouped</span>
            <span className="favorites-group__count">
              {ungrouped.length} {ungrouped.length === 1 ? "issue" : "issues"}
            </span>
          </div>
          <div className="favorites-group__body">
            <ul className="favorites-issues">
              {ungrouped.map((issue) => {
                const issueBusy = busyIssueId === issue.id;
                const errorForIssue =
                  issueError?.id === issue.id ? issueError.message : null;
                return (
                  <li key={issue.id} className="favorites-issue">
                    <IssueKeyLink
                      issueKey={issue.issueKey}
                      className="favorites-issue__key"
                    />
                    <span
                      className="favorites-issue__summary"
                      title={issue.summary ?? undefined}
                    >
                      {issue.summary ?? "(no summary)"}
                    </span>
                    <div className="favorites-issue__actions">
                      {groups.length > 0 && (
                        <select
                          className="favorites-issue__select"
                          value=""
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === "") return;
                            void handleMoveIssue(issue, Number(value));
                          }}
                          disabled={issueBusy}
                          aria-label={`Move ${issue.issueKey} to a group`}
                        >
                          <option value="">Move to group…</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className="favorites-group__btn is-danger"
                        onClick={() => void handleUnpin(issue)}
                        disabled={issueBusy}
                      >
                        Remove
                      </button>
                    </div>
                    {errorForIssue && (
                      <span className="favorites-group__error" role="alert">
                        {errorForIssue}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {groups.length === 0 && ungrouped.length === 0 ? (
        <p className="favorites-list__empty">No groups yet. Create your first group above.</p>
      ) : groups.length === 0 ? null : (
        <ul className="favorites-list">
          {groups.map((group, index) => {
            const isEditing = edit?.id === group.id;
            const rowBusy = busyGroupId === group.id;
            const errorForRow = rowError?.id === group.id ? rowError.message : null;
            const issues = issuesByGroup[group.id] ?? [];
            const pin = pinState[group.id];
            return (
              <li key={group.id} className="favorites-group">
                <div className="favorites-group__header">
                  {isEditing ? (
                    <>
                      <input
                        type="text"
                        className={
                          "favorites-group__name-input" + (edit?.error ? " is-invalid" : "")
                        }
                        value={edit!.value}
                        onChange={(event) =>
                          setEdit((prev) =>
                            prev ? { ...prev, value: event.target.value, error: null } : prev,
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void submitRename();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRename();
                          }
                        }}
                        aria-label="Group name"
                        autoFocus
                        disabled={edit!.saving}
                      />
                      <div className="favorites-group__actions">
                        <button
                          type="button"
                          className="favorites-group__btn is-primary"
                          onClick={() => void submitRename()}
                          disabled={edit!.saving || edit!.value.trim().length === 0}
                        >
                          {edit!.saving ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          className="favorites-group__btn"
                          onClick={cancelRename}
                          disabled={edit!.saving}
                        >
                          Cancel
                        </button>
                      </div>
                      {edit!.error && (
                        <span className="favorites-group__error" role="alert">
                          {edit!.error}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="favorites-group__name">{group.name}</span>
                      <span className="favorites-group__count">
                        {group.issueCount} {group.issueCount === 1 ? "issue" : "issues"}
                      </span>
                      <div className="favorites-group__actions">
                        <button
                          type="button"
                          className="favorites-group__btn"
                          onClick={() => void handleMove(group, "up")}
                          disabled={rowBusy || index === 0}
                          aria-label={`Move ${group.name} up`}
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="favorites-group__btn"
                          onClick={() => void handleMove(group, "down")}
                          disabled={rowBusy || index === groups.length - 1}
                          aria-label={`Move ${group.name} down`}
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="favorites-group__btn"
                          onClick={() => startRename(group)}
                          disabled={rowBusy}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="favorites-group__btn is-danger"
                          onClick={() => void handleDelete(group)}
                          disabled={rowBusy || group.issueCount > 0}
                          title={
                            group.issueCount > 0
                              ? "Remove issues from this group before deleting."
                              : undefined
                          }
                        >
                          Delete
                        </button>
                      </div>
                      {errorForRow && (
                        <span className="favorites-group__error" role="alert">
                          {errorForRow}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {!isEditing && (
                  <div className="favorites-group__body">
                    {issues.length === 0 ? (
                      <p className="favorites-issues__empty">No issues pinned yet.</p>
                    ) : (
                      <ul className="favorites-issues">
                        {issues.map((issue) => {
                          const issueBusy = busyIssueId === issue.id;
                          const errorForIssue =
                            issueError?.id === issue.id ? issueError.message : null;
                          return (
                            <li key={issue.id} className="favorites-issue">
                              <IssueKeyLink
                                issueKey={issue.issueKey}
                                className="favorites-issue__key"
                              />
                              <span
                                className="favorites-issue__summary"
                                title={issue.summary ?? undefined}
                              >
                                {issue.summary ?? "(no summary)"}
                              </span>
                              <div className="favorites-issue__actions">
                                <select
                                  className="favorites-issue__select"
                                  value={String(issue.groupId ?? "")}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    void handleMoveIssue(
                                      issue,
                                      value === "" ? null : Number(value),
                                    );
                                  }}
                                  disabled={issueBusy}
                                  aria-label={`Move ${issue.issueKey} to another group`}
                                >
                                  {groups.map((g) => (
                                    <option key={g.id} value={g.id}>
                                      {g.id === issue.groupId ? `${g.name} (here)` : g.name}
                                    </option>
                                  ))}
                                  <option value="">Ungrouped</option>
                                </select>
                                <button
                                  type="button"
                                  className="favorites-group__btn is-danger"
                                  onClick={() => void handleUnpin(issue)}
                                  disabled={issueBusy}
                                >
                                  Remove
                                </button>
                              </div>
                              {errorForIssue && (
                                <span className="favorites-group__error" role="alert">
                                  {errorForIssue}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <form
                      className="favorites-pin"
                      onSubmit={(event) => void handlePin(event, group.id)}
                      noValidate
                    >
                      <input
                        type="text"
                        className={
                          "favorites-pin__input" + (pin?.error ? " is-invalid" : "")
                        }
                        value={pin?.value ?? ""}
                        onChange={(event) =>
                          updatePin(group.id, { value: event.target.value, error: null })
                        }
                        placeholder="Pin issue (e.g. ABC-123)"
                        aria-label={`Pin issue to ${group.name}`}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={pin?.busy}
                      />
                      <button
                        type="submit"
                        className="favorites-group__btn is-primary"
                        disabled={pin?.busy || (pin?.value ?? "").trim().length === 0}
                      >
                        {pin?.busy ? "Pinning..." : "Pin"}
                      </button>
                      {pin?.error && (
                        <span className="favorites-group__error" role="alert">
                          {pin.error}
                        </span>
                      )}
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function formatPinError(cause: unknown): string {
  if (cause instanceof JiraError) {
    switch (cause.kind) {
      case "config":
        return cause.message;
      case "network":
        return `Could not reach Jira. ${cause.message}`;
      case "auth":
        return "Jira rejected the credentials. Check Settings.";
      case "forbidden":
        return "Your Jira account does not have access to this issue.";
      case "not_found":
        return "Issue not found in Jira. Check the key and try again.";
      default:
        return cause.status
          ? `Jira returned an error (${cause.status}): ${cause.message}`
          : `Jira returned an error: ${cause.message}`;
    }
  }
  if (cause instanceof Error) return cause.message;
  return "Failed to pin issue.";
}
