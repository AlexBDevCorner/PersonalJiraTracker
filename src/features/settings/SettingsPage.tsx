import { useEffect, useState, type FormEvent } from "react";
import { ErrorBanner, Loading } from "../../ui";
import { getSettings, saveSettings, type Settings } from "./settingsRepo";
import {
  validateSettings,
  type SettingsFormErrors,
  type SettingsFormValues,
} from "./validation";
import {
  testJiraConnection,
  formatJiraError,
  type JiraCurrentUser,
} from "../../jira";
import { log } from "../../log";
import { LogsPanel } from "./LogsPanel";
import { GitFoldersSettings } from "../gitCommits/GitFoldersSettings";
import "./SettingsPage.css";

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; user: JiraCurrentUser }
  | { status: "error"; message: string };

type LoadState =
  | { status: "loading" }
  | { status: "ready"; settings: Settings }
  | { status: "error"; message: string };

const EMPTY_VALUES: SettingsFormValues = {
  jiraBaseUrl: "",
  email: "",
  apiToken: "",
};

export function SettingsPage() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [values, setValues] = useState<SettingsFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<SettingsFormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<TestState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((settings) => {
        if (cancelled) return;
        setLoadState({ status: "ready", settings });
        setValues({
          jiraBaseUrl: settings.jiraBaseUrl ?? "",
          email: settings.email ?? "",
          apiToken: "",
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: cause instanceof Error ? cause.message : "Failed to load settings.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadState.status === "loading") {
    return <Loading label="Loading settings..." />;
  }

  if (loadState.status === "error") {
    return <ErrorBanner title="Could not load settings" message={loadState.message} />;
  }

  const hasExistingToken = loadState.settings.hasApiToken;

  const updateField = (field: keyof SettingsFormValues) => (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const nextValue = event.target.value;
    setValues((prev) => ({ ...prev, [field]: nextValue }));
    setSaved(false);
    setTestState({ status: "idle" });
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);

    const validation = validateSettings(values, { hasExistingToken });
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      return;
    }

    setSaving(true);
    try {
      await saveSettings({
        jiraBaseUrl: values.jiraBaseUrl.trim(),
        email: values.email.trim(),
        apiToken: values.apiToken.trim() || undefined,
      });
      const refreshed = await getSettings();
      setLoadState({ status: "ready", settings: refreshed });
      setValues({
        jiraBaseUrl: refreshed.jiraBaseUrl ?? "",
        email: refreshed.email ?? "",
        apiToken: "",
      });
      setSaved(true);
      setTestState({ status: "idle" });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTestState({ status: "running" });
    try {
      const user = await testJiraConnection();
      setTestState({ status: "success", user });
    } catch (cause) {
      log.error("Jira test connection failed", cause);
      setTestState({
        status: "error",
        message: formatJiraError(cause, { action: "Test connection" }),
      });
    }
  };

  const canTest = hasExistingToken && Boolean(loadState.settings.jiraBaseUrl) && Boolean(loadState.settings.email);

  return (
    <section>
      <h2>Settings</h2>
      <p>Configure your Jira Cloud connection. Credentials are stored locally on this device.</p>

      {saveError && (
        <ErrorBanner
          title="Could not save settings"
          message={saveError}
          onDismiss={() => setSaveError(null)}
        />
      )}

      <form className="settings-form" onSubmit={handleSubmit} noValidate>
        <div className="settings-form__field">
          <label className="settings-form__label" htmlFor="jira-base-url">
            Jira base URL
          </label>
          <input
            id="jira-base-url"
            type="url"
            className={
              "settings-form__input" + (errors.jiraBaseUrl ? " is-invalid" : "")
            }
            value={values.jiraBaseUrl}
            onChange={updateField("jiraBaseUrl")}
            placeholder="https://your-domain.atlassian.net"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.jiraBaseUrl)}
            aria-describedby={errors.jiraBaseUrl ? "jira-base-url-error" : undefined}
          />
          {errors.jiraBaseUrl && (
            <span id="jira-base-url-error" className="settings-form__error">
              {errors.jiraBaseUrl}
            </span>
          )}
        </div>

        <div className="settings-form__field">
          <label className="settings-form__label" htmlFor="jira-email">
            Email
          </label>
          <input
            id="jira-email"
            type="email"
            className={"settings-form__input" + (errors.email ? " is-invalid" : "")}
            value={values.email}
            onChange={updateField("email")}
            placeholder="you@example.com"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "jira-email-error" : undefined}
          />
          {errors.email && (
            <span id="jira-email-error" className="settings-form__error">
              {errors.email}
            </span>
          )}
        </div>

        <div className="settings-form__field">
          <label className="settings-form__label" htmlFor="jira-api-token">
            API token
          </label>
          <input
            id="jira-api-token"
            type="password"
            className={"settings-form__input" + (errors.apiToken ? " is-invalid" : "")}
            value={values.apiToken}
            onChange={updateField("apiToken")}
            placeholder={hasExistingToken ? "A token is saved. Enter a new one to replace it." : "Paste your Jira API token"}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.apiToken)}
            aria-describedby={errors.apiToken ? "jira-api-token-error" : "jira-api-token-hint"}
          />
          <span id="jira-api-token-hint" className="settings-form__hint">
            {hasExistingToken
              ? "Leave blank to keep the existing token. Tokens are never shown after saving."
              : "Create one at id.atlassian.com under Security > API tokens."}
          </span>
          {errors.apiToken && (
            <span id="jira-api-token-error" className="settings-form__error">
              {errors.apiToken}
            </span>
          )}
        </div>

        <div className="settings-form__actions">
          <button type="submit" className="settings-form__submit" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="settings-form__test"
            onClick={handleTestConnection}
            disabled={!canTest || testState.status === "running" || saving}
            title={canTest ? undefined : "Save Jira credentials before testing the connection."}
          >
            {testState.status === "running" ? "Testing..." : "Test connection"}
          </button>
          {saved && !saving && (
            <span className="settings-form__status is-success" role="status">
              Settings saved.
            </span>
          )}
        </div>

        {testState.status === "success" && (
          <div className="settings-form__test-result is-success" role="status">
            Connected as <strong>{testState.user.displayName}</strong>
            {testState.user.emailAddress ? ` (${testState.user.emailAddress})` : ""}.
          </div>
        )}
        {testState.status === "error" && (
          <div className="settings-form__test-result is-error" role="alert">
            {testState.message}
          </div>
        )}
      </form>

      <GitFoldersSettings />

      <LogsPanel />
    </section>
  );
}
