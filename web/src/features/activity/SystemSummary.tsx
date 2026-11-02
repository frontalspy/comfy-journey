import { useSystem } from "./hooks/useSystem";

export function SystemSummary() {
  const { data } = useSystem();
  if (!data) return null;
  const holder = data.gpuQueue.find((entry) => entry.position === 0);
  return (
    <fieldset className="chips" style={{ marginBottom: 16 }} aria-label="Server status">
      <span className="chip">
        <span
          className="status-dot"
          style={{ background: data.comfyui === "up" ? "var(--ok)" : "var(--danger)" }}
        />
        ComfyUI {data.comfyui === "up" ? "online" : "offline"}
      </span>
      <span className="chip">{data.queueLength} waiting</span>
      {holder ? <span className="chip">GPU in use by {holder.app}</span> : null}
    </fieldset>
  );
}
