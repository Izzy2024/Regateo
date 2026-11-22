import {
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { type ComponentPropsWithoutRef, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number;
  startValue?: number;
  direction?: "up" | "down";
  delay?: number;
  decimalPlaces?: number;
}

export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  decimalPlaces = 0,
  className,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const isInView = useInView(ref, { once: true, margin: "0px" });

  const initialValue = direction === "down" ? value : startValue;
  const motionValue = useMotionValue(initialValue);
  const springValue = useSpring(motionValue, {
    damping: 52,
    stiffness: 160,
  });

  const formatNumber = (num: number) =>
    Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(Number(num.toFixed(decimalPlaces)));

  useEffect(() => {
    if (prefersReducedMotion) {
      if (ref.current) {
        ref.current.textContent = formatNumber(value);
      }
      return;
    }

    if (!isInView) return;

    const timer = window.setTimeout(() => {
      motionValue.set(direction === "down" ? startValue : value);
    }, delay * 1000);

    return () => window.clearTimeout(timer);
  }, [motionValue, isInView, delay, value, direction, startValue, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    return springValue.on("change", (latest) => {
      if (ref.current) {
        ref.current.textContent = formatNumber(latest);
      }
    });
  }, [springValue, decimalPlaces, prefersReducedMotion]);

  return (
    <span
      ref={ref}
      className={cn("inline-block tabular-nums tracking-tight", className)}
      {...props}
    >
      {formatNumber(prefersReducedMotion ? value : initialValue)}
    </span>
  );
}
