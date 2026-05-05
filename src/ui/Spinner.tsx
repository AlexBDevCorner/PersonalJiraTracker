import "./Spinner.css";

type SpinnerSize = "sm" | "md" | "lg";

type SpinnerProps = {
  size?: SpinnerSize;
  label?: string;
};

export function Spinner({ size = "md", label = "Loading" }: SpinnerProps) {
  return (
    <span
      className={`spinner spinner--${size}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    />
  );
}

type LoadingProps = {
  label?: string;
  size?: SpinnerSize;
};

export function Loading({ label = "Loading...", size = "md" }: LoadingProps) {
  return (
    <div className="loading">
      <Spinner size={size} label={label} />
      <span className="loading__label">{label}</span>
    </div>
  );
}
