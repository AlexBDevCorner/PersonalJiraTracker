import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createFavoriteGroup,
  listFavoriteGroups,
  pinIssueToGroup,
  pinIssueWithoutGroup,
  type FavoriteGroup,
} from "./favoritesRepo";
import "./FavoritePicker.css";

type Props = {
  issueKey: string;
  onClose: () => void;
  onPinned: () => void;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; groups: FavoriteGroup[] }
  | { kind: "error"; message: string };

export function FavoritePicker({ issueKey, onClose, onPinned }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const newNameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFavoriteGroups()
      .then((groups) => {
        if (!cancelled) setState({ kind: "ready", groups });
      })
      .catch((cause) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            cause instanceof Error ? cause.message : "Failed to load groups.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (creating) {
      newNameRef.current?.focus();
    }
  }, [creating]);

  const pinTo = async (groupId: number) => {
    setBusy(true);
    setActionError(null);
    try {
      await pinIssueToGroup(groupId, issueKey);
      onPinned();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Failed to pin issue.",
      );
      setBusy(false);
    }
  };

  const pinUngrouped = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await pinIssueWithoutGroup(issueKey);
      onPinned();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Failed to pin issue.",
      );
      setBusy(false);
    }
  };

  const submitNewGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setActionError(null);
    try {
      const id = await createFavoriteGroup(name);
      await pinIssueToGroup(id, issueKey);
      onPinned();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Failed to create group.",
      );
      setBusy(false);
    }
  };

  return (
    <div
      className="favorite-picker__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${issueKey} to favorites`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="favorite-picker">
        <header className="favorite-picker__head">
          <div>
            <p className="favorite-picker__eyebrow">Add to favorites</p>
            <h2 className="favorite-picker__title">{issueKey}</h2>
          </div>
          <button
            type="button"
            className="favorite-picker__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {actionError && (
          <p className="favorite-picker__error" role="alert">
            {actionError}
          </p>
        )}

        <div className="favorite-picker__body">
          <p className="favorite-picker__section-label">Pick a group</p>

          {state.kind === "loading" && (
            <p className="favorite-picker__meta">Loading groups…</p>
          )}

          {state.kind === "error" && (
            <p className="favorite-picker__error" role="alert">
              {state.message}
            </p>
          )}

          {state.kind === "ready" && state.groups.length === 0 && (
            <p className="favorite-picker__meta">
              No groups yet — create one below or pin without a group.
            </p>
          )}

          {state.kind === "ready" && state.groups.length > 0 && (
            <ul className="favorite-picker__list">
              {state.groups.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    className="favorite-picker__row"
                    onClick={() => void pinTo(group.id)}
                    disabled={busy}
                  >
                    <span className="favorite-picker__row-name">
                      {group.name}
                    </span>
                    <span className="favorite-picker__row-meta">
                      {group.issueCount}{" "}
                      {group.issueCount === 1 ? "issue" : "issues"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="favorite-picker__divider" />

          {creating ? (
            <form
              className="favorite-picker__new"
              onSubmit={(event) => void submitNewGroup(event)}
            >
              <input
                ref={newNameRef}
                type="text"
                className="favorite-picker__input"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Group name"
                aria-label="New group name"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
              <button
                type="submit"
                className="favorite-picker__primary"
                disabled={busy || newName.trim().length === 0}
              >
                Create &amp; pin
              </button>
              <button
                type="button"
                className="favorite-picker__secondary"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="favorite-picker__actions">
              <button
                type="button"
                className="favorite-picker__secondary"
                onClick={() => setCreating(true)}
                disabled={busy}
              >
                + New group
              </button>
              <button
                type="button"
                className="favorite-picker__secondary"
                onClick={() => void pinUngrouped()}
                disabled={busy}
              >
                Without a group
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
