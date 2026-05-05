import { useEffect, useState, type FormEvent } from "react";
import {
  addScanRoot,
  getAuthorEmails,
  listScanRoots,
  removeScanRoot,
  setAuthorEmails,
  splitEmails,
  type ScanRoot,
} from "./index";
import "./GitFoldersSettings.css";

export function GitFoldersSettings() {
  const [roots, setRoots] = useState<ScanRoot[]>([]);
  const [pathDraft, setPathDraft] = useState("");
  const [emailsDraft, setEmailsDraft] = useState("");
  const [emailsSaved, setEmailsSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listScanRoots(), getAuthorEmails()])
      .then(([rs, emails]) => {
        if (cancelled) return;
        setRoots(rs);
        setEmailsDraft(emails.join(", "));
      })
      .catch((cause) => {
        if (cancelled) return;
        setLoadError(
          cause instanceof Error
            ? cause.message
            : "Failed to load Git settings.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAddRoot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = pathDraft.trim();
    if (!trimmed) return;
    setBusy(true);
    setActionError(null);
    try {
      await addScanRoot(trimmed);
      const next = await listScanRoots();
      setRoots(next);
      setPathDraft("");
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Failed to add folder.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveRoot = async (path: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await removeScanRoot(path);
      setRoots((prev) => prev.filter((r) => r.path !== path));
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Failed to remove folder.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEmails = async () => {
    setBusy(true);
    setActionError(null);
    setEmailsSaved(false);
    try {
      await setAuthorEmails(emailsDraft);
      const next = await getAuthorEmails();
      setEmailsDraft(next.join(", "));
      setEmailsSaved(true);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Failed to save emails.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <section className="git-folders" aria-label="Git folders">
        <h3 className="git-folders__title">Git folders</h3>
        <p className="git-folders__error" role="alert">
          {loadError}
        </p>
      </section>
    );
  }

  const previewEmails = splitEmails(emailsDraft);

  return (
    <section className="git-folders" aria-label="Git folders">
      <h3 className="git-folders__title">Git folders</h3>
      <p className="git-folders__hint">
        Folders to scan for Git repositories. The Timesheet panel will list
        commits whose message contains a Jira key, authored by the emails below.
      </p>

      {actionError && (
        <p className="git-folders__error" role="alert">
          {actionError}
        </p>
      )}

      <form className="git-folders__add" onSubmit={handleAddRoot}>
        <input
          type="text"
          className="settings-form__input"
          value={pathDraft}
          onChange={(e) => setPathDraft(e.target.value)}
          placeholder="C:\Users\you\source\repos"
          spellCheck={false}
          autoComplete="off"
          aria-label="Folder path"
        />
        <button
          type="submit"
          className="settings-form__submit"
          disabled={busy || !pathDraft.trim()}
        >
          Add folder
        </button>
      </form>

      {roots.length === 0 ? (
        <p className="git-folders__empty">No folders configured yet.</p>
      ) : (
        <ul className="git-folders__list">
          {roots.map((root) => (
            <li key={root.path} className="git-folders__item">
              <code className="git-folders__path">{root.path}</code>
              <button
                type="button"
                className="git-folders__remove"
                onClick={() => void handleRemoveRoot(root.path)}
                disabled={busy}
                aria-label={`Remove ${root.path}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="git-folders__field">
        <label className="settings-form__label" htmlFor="git-author-emails">
          Git author emails
        </label>
        <input
          id="git-author-emails"
          type="text"
          className="settings-form__input"
          value={emailsDraft}
          onChange={(e) => {
            setEmailsDraft(e.target.value);
            setEmailsSaved(false);
          }}
          placeholder="you@example.com, you@github.com"
          spellCheck={false}
          autoComplete="off"
        />
        <span className="settings-form__hint">
          Comma-separated. Match against Git commit author email. Leave blank
          to fall back to the Jira email above.
          {previewEmails.length > 0 && (
            <> Detected: {previewEmails.join(", ")}.</>
          )}
        </span>
        <div className="git-folders__actions">
          <button
            type="button"
            className="settings-form__submit"
            onClick={() => void handleSaveEmails()}
            disabled={busy}
          >
            Save emails
          </button>
          {emailsSaved && (
            <span className="settings-form__status is-success" role="status">
              Emails saved.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
