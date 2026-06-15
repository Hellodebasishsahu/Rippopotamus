import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

export type QueueMenuOption = {
  id: string;
  label: string;
  detail?: string;
};

type QueueMenuProps = {
  value: string;
  options: QueueMenuOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** Short text on trigger when closed (defaults to selected option label) */
  triggerText?: string;
  align?: "left" | "right";
  className?: string;
};

export function QueueMenu({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  triggerText,
  align = "left",
  className = "",
}: QueueMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.id === value) || options[0];
  const display = triggerText ?? selected?.label ?? "…";

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    }
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className={`queue-menu ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="queue-menu-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="queue-menu-trigger-text">{display}</span>
        <ChevronDown size={12} strokeWidth={2} className="queue-menu-chevron" aria-hidden />
      </button>
      {open ? (
        <ul
          id={listId}
          className={`queue-menu-panel queue-menu-panel-${align}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((opt) => (
            <li key={opt.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={opt.id === value}
                className={`queue-menu-option${opt.id === value ? " is-selected" : ""}`}
                onClick={() => {
                  onChange(opt.id);
                  close();
                }}
              >
                <span className="queue-menu-option-label">{opt.label}</span>
                {opt.detail ? <span className="queue-menu-option-detail">{opt.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
