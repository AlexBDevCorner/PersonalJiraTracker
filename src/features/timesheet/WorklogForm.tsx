import { useEffect, useState } from "react";
import type { WorklogEntry, WorklogInput } from "./worklogsRepo";
import "./WorklogForm.css";

type Props = {
  mode: "create" | "edit";
  initial?: WorklogEntry;
  submitting?: boolean;
  onSubmit: (input: WorklogInput) => void | Promise<void>;
  onCancel?: () => void;
};

type FieldErrors = {
  hours?: string;
  comment?: string;
};

function formatHours(hours: number): string {
  if (hours === 0) return "";
  return Number.parseFloat(hours.toFixed(2)).toString();
}

function parseHours(raw: string): number {
  return Number(raw.replace(",", "."));
}

export function WorklogForm({
  mode,
  initial,
  submitting = false,
  onSubmit,
  onCancel,
}: Props) {
  const [hours, setHours] = useState(initial ? formatHours(initial.timeSpentHours) : "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    setHours(initial ? formatHours(initial.timeSpentHours) : "");
    setComment(initial?.comment ?? "");
    setErrors({});
  }, [initial?.id]);

  const validate = (): WorklogInput | null => {
    const next: FieldErrors = {};
    const hoursValue = parseHours(hours);
    if (!hours.trim() || !Number.isFinite(hoursValue) || hoursValue <= 0) {
      next.hours = "Hours must be greater than 0.";
    }
    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      next.comment = "Comment is required.";
    }
    setErrors(next);
    if (next.hours || next.comment) return null;
    return { timeSpentHours: hoursValue, comment: trimmedComment };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = validate();
    if (!input) return;
    await onSubmit(input);
  };

  return (
    <form className="worklog-form" onSubmit={handleSubmit} noValidate>
      <h4 className="worklog-form__title">
        {mode === "edit" ? "Edit entry" : "Add entry"}
      </h4>
      <div className="worklog-form__row">
        <label className="worklog-form__field">
          <span className="worklog-form__label">Hours</span>
          <input
            type="text"
            inputMode="decimal"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            placeholder="1.5"
            className={
              "worklog-form__input" + (errors.hours ? " has-error" : "")
            }
            disabled={submitting}
            aria-invalid={errors.hours ? true : undefined}
            aria-describedby={errors.hours ? "worklog-form-hours-error" : undefined}
          />
          {errors.hours && (
            <span
              id="worklog-form-hours-error"
              className="worklog-form__error"
              role="alert"
            >
              {errors.hours}
            </span>
          )}
        </label>
        <label className="worklog-form__field worklog-form__field--grow">
          <span className="worklog-form__label">Comment</span>
          <input
            type="text"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What did you work on?"
            className={
              "worklog-form__input" + (errors.comment ? " has-error" : "")
            }
            disabled={submitting}
            aria-invalid={errors.comment ? true : undefined}
            aria-describedby={
              errors.comment ? "worklog-form-comment-error" : undefined
            }
          />
          {errors.comment && (
            <span
              id="worklog-form-comment-error"
              className="worklog-form__error"
              role="alert"
            >
              {errors.comment}
            </span>
          )}
        </label>
      </div>
      <div className="worklog-form__actions">
        {onCancel && (
          <button
            type="button"
            className="worklog-form__btn"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="worklog-form__btn is-primary"
          disabled={submitting}
        >
          {submitting
            ? "Saving…"
            : mode === "edit"
              ? "Save changes"
              : "Add entry"}
        </button>
      </div>
    </form>
  );
}
