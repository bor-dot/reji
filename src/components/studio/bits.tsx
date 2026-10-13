import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export const fieldClass =
  "w-full rounded-lg bg-subtle px-3 text-base text-fg ring-1 ring-line outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-paper";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "line" | "quiet";
};

export function Button({ variant = "solid", className = "", type = "button", ...props }: ButtonProps) {
  const look = {
    solid: "bg-paper text-ink",
    line: "bg-transparent text-fg ring-1 ring-line",
    quiet: "bg-transparent text-muted",
  }[variant];
  return (
    <button
      type={type}
      className={`press inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${look} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="text-sm text-faint">{hint}</span> : null}
    </label>
  );
}

export function CopyButton({ text, label = "Kopyala" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <Button
      variant="line"
      className="h-10 px-3"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("ok");
        } catch {
          setState("fail");
        }
        window.setTimeout(() => setState("idle"), 1600);
      }}
    >
      {state === "ok" ? "Kopyalandı" : state === "fail" ? "Kopyalanamadı" : label}
    </Button>
  );
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press h-11 rounded-lg px-3 text-sm font-medium ring-1 ${
        active
          ? "bg-paper text-ink ring-paper"
          : "bg-transparent text-fg ring-line"
      }`}
    >
      {children}
    </button>
  );
}
