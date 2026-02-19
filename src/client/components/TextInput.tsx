import { forwardRef } from "react";
import { colors } from "../theme";

const BASE_STYLE: React.CSSProperties = {
  background: colors.surfaceAlt,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: "0.5rem 0.75rem",
  color: colors.text,
  fontSize: "1rem",
  outline: "none",
};

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ style, onFocus, onBlur, ...rest }, ref) {
    return (
      <input
        ref={ref}
        style={{ ...BASE_STYLE, ...style }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = colors.accent;
          onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = colors.border;
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  }
);
