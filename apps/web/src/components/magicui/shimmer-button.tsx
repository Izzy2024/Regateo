import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface ShimmerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerDuration?: string;
}

export function ShimmerButton({
  shimmerDuration = "3.8s",
  className,
  children,
  style,
  type = "button",
  ...props
}: ShimmerButtonProps) {
  const buttonStyle = {
    ...style,
    "--shimmer-duration": shimmerDuration,
  } as CSSProperties;

  return (
    <button
      type={type}
      style={buttonStyle}
      className={cn(
        "group relative inline-flex h-8 items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-[#E64825] px-3 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(230,72,37,0.28)] transition-[background-color,transform,box-shadow] duration-150 hover:bg-[#CF3C1C] hover:shadow-[0_2px_8px_rgba(230,72,37,0.3)] active:translate-y-px disabled:pointer-events-none disabled:opacity-50 cursor-pointer sm:px-3.5",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      >
        <span className="animate-regateo-shimmer absolute inset-y-0 -left-1/3 w-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      </span>
      <span className="relative z-10 inline-flex items-center gap-1.5">
        {children}
      </span>
    </button>
  );
}
