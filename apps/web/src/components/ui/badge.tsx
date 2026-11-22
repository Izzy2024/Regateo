import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold leading-tight tracking-[-0.01em] whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-[#F4F3EE] text-[#111315] border border-[#E7E5DF]",
        savings: "bg-[#E64825] text-white",
        savingsSoft: "bg-[#FEF2EE] text-[#B83416] border border-[#FBCFC3]",
        best: "bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]",
        muted: "bg-[#F4F3EE] text-[#525866]",
        outline: "bg-white text-[#525866] border border-[#E7E5DF]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
