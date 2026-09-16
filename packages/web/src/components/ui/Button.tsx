import type { ButtonHTMLAttributes } from "react";

// Four button weights, one timing curve. Micro-controls transition on
// 0.1s ease-in (brightness + 1px lift); large CTAs use 0.2s ease-in-out
// and brighten only, with no movement. There is never a hue shift on hover.
export type ButtonVariant = "primary" | "dark" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "cta";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-500 text-white",
  dark: "bg-ink text-paper",
  outline: "border-[1.5px] border-ink bg-transparent text-ink",
  ghost: "bg-paper-3 text-ink",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-[13px]",
  md: "px-[22px] py-[11px] text-sm",
  cta: "px-11 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  // Large CTAs brighten without lifting; everything smaller lifts 1px.
  const motion =
    size === "cta"
      ? "transition duration-200 ease-in-out hover:brightness-[1.06]"
      : "transition duration-100 ease-in hover:-translate-y-px hover:brightness-[1.06] active:translate-y-0 active:brightness-[0.96]";

  return (
    <button
      className={`inline-flex items-center gap-2 rounded-md font-semibold disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${motion} ${className}`}
      {...props}
    />
  );
}
