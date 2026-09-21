import { useState } from "react";
import { formatRupeesCompact } from "../../lib/backtestFormat.js";

// A rupee amount input that reads as a compact figure (₹1L, ₹12.5Cr) when
// idle and switches to the exact Indian-grouped number (1,00,000) the
// moment it's focused, so entering precise amounts doesn't fight with the
// compact display — the compact form is a summary, not the editable value.
// A plain <input type="number"> can't render digit grouping, so this stays
// type="text" throughout and parses the grouping back out on change.
export function AmountInput({
  value,
  onChange,
  placeholder = "0",
  className = "",
}: {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);

  const displayValue = focused
    ? value > 0
      ? value.toLocaleString("en-IN", { maximumFractionDigits: 0 })
      : ""
    : value > 0
      ? formatRupeesCompact(value)
      : "";

  function handleChange(raw: string) {
    const digitsOnly = raw.replace(/[^0-9]/g, "");
    onChange(digitsOnly === "" ? 0 : Number(digitsOnly));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={displayValue}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => handleChange(e.target.value)}
      className={`h-9 border border-line bg-paper px-3 text-[13px] text-ink placeholder:text-muted focus:border-ink focus:outline-none ${className}`}
    />
  );
}
