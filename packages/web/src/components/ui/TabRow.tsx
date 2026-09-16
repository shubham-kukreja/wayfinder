// Underlined tab row: quiet until active, then ink text over a 2px ink rule.
// Shared so every in-panel switcher in the app reads as the same control.
export function TabRow<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-[22px] border-b border-line text-[13px] font-semibold ${className}`}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-current={value === option.id ? "page" : undefined}
          className={`-mb-px border-b-2 pb-2.5 transition-colors duration-100 ease-in ${
            value === option.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
