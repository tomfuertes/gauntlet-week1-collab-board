import { useEffect } from "react";
import { colors } from "../theme";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}

export function Modal({ open, onClose, children, width = 520 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
        animation: "cb-backdrop-in 0.3s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "calc(100vw - 48px)",
          background: "rgba(15, 23, 42, 0.97)",
          border: `1px solid ${colors.border}`,
          borderRadius: 20,
          padding: "2.5rem 2.5rem 2rem",
          boxShadow: `0 0 80px ${colors.accentGlow}, 0 16px 48px rgba(0,0,0,0.6)`,
          animation: "cb-overlay-in 0.4s ease-out both",
        }}
      >
        {children}
      </div>
    </div>
  );
}
