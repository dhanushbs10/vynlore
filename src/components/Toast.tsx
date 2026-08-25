import { useEffect, useRef } from "react";
import { Music2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const timer = useRef<number | null>(null);

  useEffect(() => {
    timer.current = window.setTimeout(() => {
      onDismiss(toast.id);
    }, 4000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [toast.id, onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="pointer-events-auto flex items-center gap-2.5 px-4 py-3 min-w-[240px] max-w-[380px] bg-bg-elevated border border-border rounded-xl shadow-lg text-text text-sm font-medium"
    >
      <Music2 className="shrink-0 w-[18px] h-[18px] text-accent" />
      <div className="flex flex-col gap-px min-w-0">
        <span className="font-semibold truncate">{toast.title}</span>
        {toast.subtitle && <span className="text-xs text-text-secondary truncate">{toast.subtitle}</span>}
      </div>
    </motion.div>
  );
}
