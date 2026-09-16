// Binary setting: 36x20 track, brand fill when on, line fill when off.
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-block h-5 w-9 rounded-full transition-colors duration-100 ease-in disabled:opacity-40 ${
        checked ? "bg-brand-500" : "bg-line"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all duration-100 ease-in ${
          checked ? "right-0.5" : "right-[18px]"
        }`}
      />
    </button>
  );
}
