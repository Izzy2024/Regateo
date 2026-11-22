import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-lg border border-[#E7E5DF] bg-white px-3 py-2 text-sm text-[#111315] placeholder:text-[#666D7C] transition-colors duration-150 hover:border-[#D5D2C9] focus:border-[#E64825] focus:outline-none focus:ring-2 focus:ring-[#E64825]/15 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
