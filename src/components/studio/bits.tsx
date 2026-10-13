import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

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
      className="h-11 px-3"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("ok");
        } catch (error) {
      console.warn(error);
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
      className={`press h-11 min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium ring-1 ${
        active
          ? "bg-paper text-ink ring-paper"
          : "bg-transparent text-fg ring-line"
      }`}
    >
      {children}
    </button>
  );
}

export function ScrollRow({
  label,
  fade = "bg",
  children,
}: {
  label: string;
  fade?: "bg" | "elevated";
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const wash = fade === "elevated" ? "from-elevated" : "from-bg";

  function measure() {
    const node = scroller.current;
    if (!node) return;
    const left = node.scrollLeft > 8;
    const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 8;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }

  useEffect(() => {
    measure();
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  function nudge(direction: -1 | 1) {
    scroller.current?.scrollBy({ left: direction * 160, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div
        ref={scroller}
        className="scroll-row flex gap-2 overflow-x-auto"
        aria-label={label}
        onScroll={measure}
      >
        {children}
      </div>
      {edges.left ? (
        <>
          <span className={`pointer-events-none absolute inset-y-0 left-10 w-6 bg-gradient-to-r ${wash} to-transparent`} />
          <button
            type="button"
            aria-label="Sola kaydır"
            className="press absolute top-0 left-0 flex size-11 items-center justify-center text-fg"
            onClick={() => nudge(-1)}
          >
            <Chevron direction="left" />
          </button>
        </>
      ) : null}
      {edges.right ? (
        <>
          <span className={`pointer-events-none absolute inset-y-0 right-10 w-6 bg-gradient-to-l ${wash} to-transparent`} />
          <button
            type="button"
            aria-label="Sağa kaydır"
            className="press absolute top-0 right-0 flex size-11 items-center justify-center text-fg"
            onClick={() => nudge(1)}
          >
            <Chevron direction="right" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" fill="none">
      <path
        d={direction === "right" ? "M6 3.5 10.5 8 6 12.5" : "M10 3.5 5.5 8 10 12.5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
