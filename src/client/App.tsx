import { useEffect, useState } from "react";

export function App() {
  const [status, setStatus] = useState("connecting...");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<{ status: string }>)
      .then((data) => setStatus(data.status))
      .catch(() => setStatus("offline"));
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: "1rem",
      }}
    >
      <h1 style={{ fontSize: "3rem" }}>CollabBoard</h1>
      <p>
        API: <code style={{ color: status === "ok" ? "#4ade80" : "#f87171" }}>{status}</code>
      </p>
      <p style={{ color: "#888", fontSize: "0.875rem" }}>v0.0.1 - hello world</p>
    </div>
  );
}
