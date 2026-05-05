import type { ReactNode } from "react";
import "./ErrorBanner.css";

type ErrorBannerProps = {
  title?: string;
  message: ReactNode;
  onRetry?: () => void;
  onDismiss?: () => void;
};

export function ErrorBanner({
  title = "Something went wrong",
  message,
  onRetry,
  onDismiss,
}: ErrorBannerProps) {
  return (
    <div className="error-banner" role="alert">
      <div className="error-banner__body">
        <strong className="error-banner__title">{title}</strong>
        <span className="error-banner__message">{message}</span>
      </div>
      {(onRetry || onDismiss) && (
        <div className="error-banner__actions">
          {onRetry && (
            <button
              type="button"
              className="error-banner__action"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              className="error-banner__action"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
