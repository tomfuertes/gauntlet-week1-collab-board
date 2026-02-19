import { colors } from "../theme";

type Variant = "primary" | "secondary" | "danger" | "link";
type Size = "sm" | "md";

const VARIANT_STYLES: Record<Variant, React.CSSProperties> = {
  primary: { background: colors.accent, color: "#fff", border: "none", borderRadius: 4 },
  secondary: { background: "none", color: colors.textMuted, border: `1px solid ${colors.borderLight}`, borderRadius: 4 },
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
      style={{
        ...variantStyle,
        padding,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "0.75rem",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
      {...rest}
    />
  );
}
