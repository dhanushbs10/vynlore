import { useState, useEffect, useRef } from "react";
import "../styles/toast.css";
import { Music2 } from "lucide-react";

export interface ToastMessage {
  id: number;
  title: string;
  subtitle?: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function Toast({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    timer.current = window.setTimeout(() => {
      setLeaving(true);
      setTimeout(() => onDismiss(toast.id), 200);
    }, 4000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [toast.id, onDismiss]);

  return (
    <div className={`toast-item${leaving ? " leaving" : ""}`}>
      <Music2 className="toast-icon" />
      <div className="toast-body">
        <span className="toast-title">{toast.title}</span>
        {toast.subtitle && <span className="toast-sub">{toast.subtitle}</span>}
      </div>
    </div>
  );
}