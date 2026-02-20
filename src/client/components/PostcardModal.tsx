import { useCallback, useState } from "react";
import type { UIMessage } from "ai";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { colors } from "../theme";

// KEY-DECISION 2026-02-20: 1200x630 matches Open Graph image spec, making postcards
// shareable as rich preview cards on social/messaging platforms.
const POSTCARD_W = 1200;
const POSTCARD_H = 630;

// Extract plain text from a UIMessage. UIMessage uses .parts[] not .content
// (parts can be text or tool calls; we join text parts only).
function getMessageText(msg: UIMessage): string {
  let text = "";
  for (const part of msg.parts) {
    if (part.type === "text") text += part.text;
  }
  return text;
}

interface PostcardModalProps {
  open: boolean;
  onClose: () => void;
  snapshotDataUrl: string;
  messages: UIMessage[];
  boardId: string;
}

export function PostcardModal({ open, onClose, snapshotDataUrl, messages, boardId }: PostcardModalProps) {
  // Last 5 messages that have text (skip tool-only messages)
  const quotable = messages.filter((m) => getMessageText(m).trim().length > 0).slice(-5);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(quotable.length > 0 ? quotable.length - 1 : null);

  const selectedMsg = selectedIdx !== null ? quotable[selectedIdx] : null;
  const selectedQuote = selectedMsg ? getMessageText(selectedMsg).trim() : "";

  const handleDownload = useCallback(() => {
    const offscreen = document.createElement("canvas");
    offscreen.width = POSTCARD_W;
    offscreen.height = POSTCARD_H;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;

    // Background fill (matches app dark theme)
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, POSTCARD_W, POSTCARD_H);

    // Draw canvas snapshot (centered, letterboxed to fit)
    const img = new Image();
    img.onload = () => {
      // Leave space: 80px header + 160px quote area
      const contentH = POSTCARD_H - 80 - 160;
      const contentW = POSTCARD_W - 64;
      const imgAspect = img.width / img.height;
      const areaAspect = contentW / contentH;
      let drawW = contentW;
      let drawH = contentH;
      if (imgAspect > areaAspect) {
        drawH = contentW / imgAspect;
      } else {
        drawW = contentH * imgAspect;
      }
      const drawX = (POSTCARD_W - drawW) / 2;
      const drawY = 80 + (contentH - drawH) / 2;

      // Subtle rounded clipping for the canvas image
      ctx.save();
      const r = 12;
      ctx.beginPath();
      ctx.moveTo(drawX + r, drawY);
      ctx.lineTo(drawX + drawW - r, drawY);
      ctx.arcTo(drawX + drawW, drawY, drawX + drawW, drawY + r, r);
      ctx.lineTo(drawX + drawW, drawY + drawH - r);
      ctx.arcTo(drawX + drawW, drawY + drawH, drawX + drawW - r, drawY + drawH, r);
      ctx.lineTo(drawX + r, drawY + drawH);
      ctx.arcTo(drawX, drawY + drawH, drawX, drawY + drawH - r, r);
      ctx.lineTo(drawX, drawY + r);
      ctx.arcTo(drawX, drawY, drawX + r, drawY, r);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      ctx.restore();

      // Header: "CollabBoard" title
      ctx.fillStyle = "#eee";
      ctx.font = "bold 28px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("CollabBoard", 40, 52);

      // Header: board ID (dimmed)
      ctx.fillStyle = "#64748b";
      ctx.font = "16px system-ui, -apple-system, sans-serif";
      ctx.fillText(`#${boardId}`, 40, 68);

      // Quote overlay at bottom
      if (selectedQuote) {
        const quoteY = POSTCARD_H - 160;
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(0, quoteY, POSTCARD_W, 160);

        // Quote text (word-wrapped)
        ctx.fillStyle = "#eee";
        ctx.font = "italic 22px Georgia, serif";
        ctx.textAlign = "left";
        const quoteX = 48;
        const maxQuoteW = POSTCARD_W - 96;
        const quoteLines = wrapText(ctx, `"${selectedQuote}"`, maxQuoteW);
        const lineH = 30;
        const totalH = quoteLines.length * lineH;
        const startY = quoteY + (160 - totalH) / 2 + 20;
        quoteLines.forEach((line, i) => {
          ctx.fillText(line, quoteX, startY + i * lineH);
        });

        // Speaker label
        if (selectedMsg) {
          ctx.fillStyle = "#6366f1";
          ctx.font = "bold 14px system-ui, -apple-system, sans-serif";
          ctx.fillText(selectedMsg.role === "assistant" ? "AI" : "Player", quoteX, quoteY + 140);
        }
      }

      // Watermark: bottom-right
      ctx.fillStyle = "#334155";
      ctx.font = "12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("made with CollabBoard", POSTCARD_W - 20, POSTCARD_H - 12);

      // Trigger download
      const link = document.createElement("a");
      link.download = `collabboard-postcard-${boardId}.png`;
      link.href = offscreen.toDataURL("image/png");
      link.click();
    };
    img.src = snapshotDataUrl;
  }, [snapshotDataUrl, selectedQuote, selectedMsg, boardId]);

  return (
    <Modal open={open} onClose={onClose} width={680}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Title */}
        <div>
          <h2 style={{ margin: 0, color: colors.text, fontSize: "1.125rem", fontWeight: 700 }}>Scene Postcard</h2>
          <p style={{ margin: "4px 0 0", color: colors.textMuted, fontSize: "0.8125rem" }}>
            Choose a quote to overlay, then download your postcard.
          </p>
        </div>

        {/* Canvas preview */}
        {snapshotDataUrl && (
          <div
            style={{
              borderRadius: 8,
              overflow: "hidden",
              border: `1px solid ${colors.border}`,
              background: colors.surfaceAlt,
              aspectRatio: "1200/630",
              position: "relative",
            }}
          >
            <img
              src={snapshotDataUrl}
              alt="Canvas snapshot"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            {/* Quote preview overlay */}
            {selectedQuote && (
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: "rgba(0,0,0,0.75)",
                  padding: "12px 16px",
                  color: colors.text,
                  fontSize: "0.75rem",
                  fontStyle: "italic",
                  lineHeight: 1.5,
                }}
              >
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  &ldquo;{selectedQuote}&rdquo;
                </span>
                <span style={{ color: colors.accent, fontSize: "0.6875rem", fontStyle: "normal", fontWeight: 600 }}>
                  - {selectedMsg?.role === "assistant" ? "AI" : "Player"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Quote picker */}
        {quotable.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                color: colors.textMuted,
                fontSize: "0.75rem",
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              Choose a quote
            </span>
            {quotable.map((msg, i) => {
              const text = getMessageText(msg).trim();
              const isSelected = selectedIdx === i;
              const isAI = msg.role === "assistant";
              return (
                <button
                  key={i}
                  onClick={() => setSelectedIdx(isSelected ? null : i)}
                  style={{
                    textAlign: "left",
                    background: isSelected ? colors.accentSubtle : "transparent",
                    border: `1px solid ${isSelected ? colors.accent : colors.border}`,
                    borderRadius: 8,
                    padding: "8px 12px",
                    cursor: "pointer",
                    color: isSelected ? colors.text : colors.textMuted,
                    fontSize: "0.8125rem",
                    lineHeight: 1.5,
                    transition: "all 0.15s ease",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                      color: isAI ? colors.accentLight : colors.warning,
                      display: "block",
                      marginBottom: 2,
                    }}
                  >
                    {isAI ? "AI" : "Player"}
                  </span>
                  <span
                    style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {text.length > 120 ? text.slice(0, 120) + "…" : text}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p style={{ color: colors.textMuted, fontSize: "0.8125rem", margin: 0 }}>
            No chat messages yet. Start a scene and come back!
          </p>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleDownload}>
            Download PNG
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Simple word-wrap helper for the offscreen canvas compositing
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4); // cap at 4 lines to fit quote area
}
