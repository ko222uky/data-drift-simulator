import type { ActionMessage } from "@/lib/useOperatorAction";

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:opacity-90",
    secondary: "border border-line text-ink hover:bg-wash",
    danger: "border border-line text-critical hover:bg-wash",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export function StatusMessage({ message }: { message: ActionMessage | null }) {
  if (!message) return null;
  return (
    <p role="status" className={`mt-3 text-xs ${message.tone === "error" ? "text-critical" : "text-ink-2"}`}>
      {message.tone === "error" ? "⚠ " : "✓ "}
      {message.text}
    </p>
  );
}
