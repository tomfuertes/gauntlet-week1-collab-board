import { useState, useRef, useEffect } from "react";
import { colors } from "../theme";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  style?: React.CSSProperties;
}

export function Select({ value, onChange, options, style }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // KEY-DECISION 2026-02-21: Position dropdown above if insufficient space below
      const estimatedHeight = options.length * 32 + 16; // ~32px per option + padding
      const spaceBelow = window.innerHeight - rect.bottom;
      const positionAbove = spaceBelow < estimatedHeight && rect.top > estimatedHeight;
      const top = positionAbove ? rect.top - estimatedHeight - 4 : rect.bottom + 4;
      setDropdownPos({ top, left: rect.left, width: rect.width });
      setFocusedIndex(options.findIndex((o) => o.value === value));
    }
  }, [open, value, options]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        onChange(options[focusedIndex].value);
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, focusedIndex, options, onChange]);

  return (
    <div style={{ position: "relative", display: "inline-block", ...style }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = colors.accentLight;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border;
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: colors.overlayHeader,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: "4px 12px",
          color: colors.text,
          fontSize: "0.75rem",
          cursor: "pointer",
          outline: "none",
          whiteSpace: "nowrap",
        }}
      >
        {selectedLabel}
        <span style={{ fontSize: "0.55rem", opacity: 0.6, marginLeft: 2 }}>▼</span>
      </button>

      {open && (
        <>
          {/* Transparent overlay catches outside clicks - simpler than document event listener */}
          <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          {/* KEY-DECISION 2026-02-20: position:fixed so dropdown escapes overflow:hidden parents (header, modal) */}
          <div
            style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              minWidth: dropdownPos.width,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              backdropFilter: "blur(12px)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
              zIndex: 100,
              overflow: "hidden",
            }}
          >
            {options.map((opt, i) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                onMouseEnter={() => setFocusedIndex(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "6px 12px",
                  background: i === focusedIndex ? colors.accentSubtle : "transparent",
                  border: "none",
                  color: colors.text,
                  fontSize: "0.75rem",
                  cursor: "pointer",
                  textAlign: "left",
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    opacity: opt.value === value ? 1 : 0,
                    color: colors.accentLight,
                    fontSize: "0.7rem",
                  }}
                >
                  ✓
                </span>
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
