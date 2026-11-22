import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  className?: string;
  reverse?: boolean;
  pauseOnHover?: boolean;
  children: React.ReactNode;
  repeat?: number;
  durationSeconds?: number;
  gap?: string;
}

export function Marquee({
  className,
  reverse = false,
  pauseOnHover = true,
  children,
  repeat = 3,
  durationSeconds = 36,
  gap = "0.75rem",
  style,
  ...props
}: MarqueeProps) {
  const marqueeStyle = {
    ...style,
    "--duration": `${durationSeconds}s`,
    "--gap": gap,
  } as CSSProperties;

  return (
    <div
      {...props}
      style={marqueeStyle}
      className={cn(
        "group marquee-edge-mask flex overflow-hidden [gap:var(--gap)]",
        className
      )}
    >
      {Array.from({ length: repeat }).map((_, index) => (
        <div
          key={index}
          aria-hidden={index > 0 ? true : undefined}
          className={cn(
            "animate-regateo-marquee flex shrink-0 items-center justify-around [gap:var(--gap)]",
            reverse && "animate-regateo-marquee-reverse",
            pauseOnHover && "group-hover:[animation-play-state:paused]"
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
