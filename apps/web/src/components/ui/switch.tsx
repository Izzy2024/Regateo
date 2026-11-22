import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Switch({
  checked,
  onCheckedChange,
  id,
  label,
  description,
  disabled,
}: SwitchProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-center justify-between gap-3 py-1.5 select-none",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      )}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[#111315]">{label}</span>
        {description ? (
          <span className="block text-xs text-[#666D7C]">{description}</span>
        ) : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 cursor-pointer",
          checked
            ? "border-[#E64825] bg-[#E64825]"
            : "border-[#D5D2C9] bg-[#E7E5DF]"
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform duration-150",
            checked ? "translate-x-[17px]" : "translate-x-[2px]"
          )}
        />
      </button>
    </label>
  );
}
