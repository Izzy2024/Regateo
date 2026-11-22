import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect } from "react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: "right" | "left";
  title?: string;
  subtitle?: string;
  headerIcon?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  side = "right",
  title,
  subtitle,
  headerIcon,
  headerActions,
  children,
  className,
}: SheetProps) {
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

  const isRight = side === "right";

  return (
    <AnimatePresence>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#111315]/40 backdrop-blur-[2px]"
          />

          <motion.aside
            initial={{ x: isRight ? "100%" : "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: isRight ? "100%" : "-100%" }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "relative z-10 flex h-full w-full max-w-[460px] flex-col border-[#E7E5DF] bg-white modal-elevation",
              isRight ? "ml-auto border-l" : "mr-auto border-r",
              className
            )}
          >
            {title ? (
              <div className="flex items-center justify-between gap-3 border-b border-[#E7E5DF] px-5 py-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  {headerIcon}
                  <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-bold tracking-[-0.015em] text-[#111315]">
                      {title}
                    </h2>
                    {subtitle ? (
                      <p className="truncate text-xs text-[#525866]">{subtitle}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {headerActions}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Cerrar panel"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#525866] transition-colors hover:bg-[#F4F3EE] hover:text-[#111315] cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
