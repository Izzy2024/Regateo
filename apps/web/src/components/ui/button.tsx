import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E64825] disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none",
  {
    variants: {
      variant: {
        primary: "bg-[#111315] text-white hover:bg-[#23272D]",
        brand: "bg-[#E64825] text-white hover:bg-[#CF3C1C]",
        emerald: "bg-[#059669] text-white hover:bg-[#047857]",
        secondary:
          "bg-[#F4F3EE] text-[#111315] hover:bg-[#EAE8E0] border border-[#E7E5DF]",
        outline:
          "bg-white text-[#111315] border border-[#E7E5DF] hover:bg-[#F4F3EE] hover:border-[#D5D2C9]",
        ghost: "bg-transparent text-[#525866] hover:bg-[#F4F3EE] hover:text-[#111315]",
        destructive: "bg-[#DC2626] text-white hover:bg-[#B91C1C]",
      },
      size: {
        xs: "h-7 px-2.5 text-xs",
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-[15px]",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
