import { colors } from "../theme";

type Variant = "primary" | "secondary" | "danger" | "link";
type Size = "sm" | "md";

// Inject hover/active CSS once at module load - inline styles can't do :hover
const HOVER_STYLES = `
.cb-btn-primary:not(:disabled):hover { background: ${colors.accentLight} !important; }
.cb-btn-primary:not(:disabled):active { background: ${colors.accentDark} !important; }
.cb-btn-secondary:not(:disabled):hover { background: ${colors.accentSubtle} !important; border-color: ${colors.accentLight} !important; color: ${colors.text} !important; }
.cb-btn-secondary:not(:disabled):active { background: rgba(99, 102, 241, 0.2) !important; }
.cb-btn-danger:not(:disabled):hover { background: rgba(248, 113, 113, 0.1) !important; border-color: ${colors.error} !important; }
.cb-btn-link:not(:disabled):hover { color: ${colors.text} !important; }
`;

if (typeof document !== "undefined" && !document.getElementById("cb-btn-styles")) {
  const style = document.createElement("style");
  style.id = "cb-btn-styles";
  style.textContent = HOVER_STYLES;
  document.head.appendChild(style);
}

const VARIANT_STYLES: Record<Variant, React.CSSProperties> = {
  primary: { background: colors.accent, color: "#fff", border: "none", borderRadius: 4 },
  secondary: {
    background: "none",
    color: colors.textMuted,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: 4,
  },
  danger: { background: "none", color: colors.error, border: `1px solid ${colors.borderLight}`, borderRadius: 4 },
  link: { background: "none", color: colors.textMuted, border: "none", borderRadius: 0, padding: 0 },
};

const SIZE_PADDING: Record<Size, string> = {
  sm: "0.25rem 0.5rem",
  md: "0.5rem 0.75rem",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = "secondary", size = "sm", style, disabled, ...rest }: ButtonProps) {
  const variantStyle = VARIANT_STYLES[variant];
  const padding = variant === "link" ? 0 : SIZE_PADDING[size];

  return (
    <button
      disabled={disabled}
      className={`cb-btn-${variant}`}
      style={{
        ...variantStyle,
        padding,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "0.75rem",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.15s ease",
        ...style,
      }}
      {...rest}
    />
  );
}
