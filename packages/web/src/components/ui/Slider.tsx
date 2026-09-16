import type { InputHTMLAttributes } from "react";

// Boxy range input matching the dashboard's flat language: square thumb,
// tall square track, a filled portion in brand green, no rounding anywhere.
//
// Native range inputs can't be styled with Tailwind alone — ::-webkit-slider-thumb
// and ::-moz-range-thumb only take real CSS — so the appearance lives in
// index.css under .wf-slider. The fill is painted via a linear-gradient
// background whose stop is driven by the current value, which keeps this a
// real <input type="range"> (keyboard, arrow keys, screen readers) rather
// than a div pretending to be one.
export function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  className = "",
  ...props
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value">) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ["--wf-fill" as string]: `${pct}%` }}
      className={`wf-slider ${className}`}
      {...props}
    />
  );
}
