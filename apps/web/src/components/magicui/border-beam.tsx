import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface BorderBeamProps {
  className?: string;
  duration?: number;
  borderWidth?: number;
  colorFrom?: string;
  colorTo?: string;
}

export function BorderBeam({
  className,
  duration = 7,
  borderWidth = 1.5,
  colorFrom = "#E64825",
  colorTo = "#059669",
}: BorderBeamProps) {
  const wrapperStyle = {
    padding: `${borderWidth}px`,
    "--beam-duration": `${duration}s`,
  } as CSSProperties;

  const gradientStyle: CSSProperties = {
    background: `conic-gradient(from 0deg, transparent 0deg, transparent 275deg, ${colorFrom} 320deg, ${colorTo} 352deg, transparent 360deg)`,
  };

  return (
    <div
      aria-hidden="true"
      style={wrapperStyle}
      className={cn(
        "border-beam-mask pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit]",
        className
      )}
    >
      <div
        style={gradientStyle}
        className="animate-regateo-beam absolute left-1/2 top-1/2 aspect-square w-[max(200%,640px)] opacity-90"
      />
    </div>
  );
}
