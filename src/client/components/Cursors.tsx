import { Group, Line, Text } from "react-konva";

// Distinct colors for up to 10 users
const CURSOR_COLORS = [
  "#f87171", "#60a5fa", "#4ade80", "#fbbf24", "#a78bfa",
  "#f472b6", "#34d399", "#fb923c", "#818cf8", "#22d3ee",
];

interface CursorState {
  userId: string;
  username: string;
  x: number;
  y: number;
}

export function Cursors({ cursors }: { cursors: Map<string, CursorState> }) {
  return (
    <>
      {[...cursors.values()].map((cursor, i) => {
        const color = CURSOR_COLORS[i % CURSOR_COLORS.length];
        return (
          <Group key={cursor.userId} x={cursor.x} y={cursor.y}>
            {/* Arrow cursor shape */}
            <Line
              points={[0, 0, 0, 16, 4, 12, 8, 20, 11, 19, 7, 11, 12, 11]}
              fill={color}
              closed
              stroke={color}
              strokeWidth={0.5}
            />
            {/* Name label */}
            <Text
              x={14}
              y={10}
              text={cursor.username}
              fontSize={11}
              fill="#fff"
              padding={2}
              // Background via Konva text background
            />
          </Group>
        );
      })}
    </>
  );
}
