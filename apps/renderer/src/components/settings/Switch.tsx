interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export default function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
        checked ? "justify-end bg-accent" : "justify-start bg-line"
      }`}
    >
      <span
        aria-hidden
        className="h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/10"
      />
    </button>
  );
}
