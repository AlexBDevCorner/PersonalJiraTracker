import { Component, type ErrorInfo, type ReactNode } from "react";
import { log } from "../log";
import { ErrorBanner } from "./ErrorBanner";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error("Unhandled UI error", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div className="error-banner__boundary">
        <ErrorBanner
          title="The app hit an unexpected error"
          message={error.message || "An unknown error occurred."}
          onRetry={this.reset}
        />
      </div>
    );
  }
}
