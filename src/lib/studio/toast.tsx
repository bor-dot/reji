import { useEffect, useState } from "react";

type Item = { id: number; text: string };

let pushToast: (text: string) => void = () => {};

export function notify(text: string) {
  pushToast(text);
}

export function ToastHost() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    pushToast = (text) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setItems((prev) => [...prev.slice(-3), { id, text }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }, 5000);
    };
    return () => {
      pushToast = () => {};
    };
  }, []);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-4">
      {items.map((item) => (
        <p key={item.id} role="status" className="rounded-lg bg-paper px-4 py-3 text-sm text-ink">
          {item.text}
        </p>
      ))}
    </div>
  );
}
