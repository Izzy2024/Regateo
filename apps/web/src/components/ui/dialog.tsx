import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  maxWidthClass?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  maxWidthClass = "max-w-4xl",
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#111315]/45 backdrop-blur-[2px]"
          />

          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-[#E7E5DF] bg-white modal-elevation",
              maxWidthClass,
              className
            )}
          >
            {title ? (
              <div className="flex items-start justify-between gap-4 border-b border-[#E7E5DF] px-5 py-4 sm:px-6">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold tracking-[-0.02em] text-[#111315] text-balance">
                    {title}
                  </h2>
                  {description ? (
                    <p className="mt-0.5 text-sm text-[#525866]">{description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Cerrar ventana"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-[#525866] transition-colors hover:border-[#E7E5DF] hover:bg-[#F4F3EE] hover:text-[#111315] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar ventana"
                className="absolute right-4 top-4 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E7E5DF] bg-white/95 text-[#525866] transition-colors hover:bg-[#F4F3EE] hover:text-[#111315] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <div className="flex-1 overflow-y-auto">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
