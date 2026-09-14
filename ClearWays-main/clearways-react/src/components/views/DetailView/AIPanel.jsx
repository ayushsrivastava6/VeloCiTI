import "./AIPanel.css";

export default function AIPanel({ intersection }) {
  const maxLane = intersection.lanes.reduce(
    (prev, curr) => curr.vehicleCount > prev.vehicleCount ? curr : prev,
    intersection.lanes[0]
  );
  const reason = intersection.decisionReason || "AI controller is evaluating live traffic conditions.";
  const allocatedGreen = Number(intersection.allocatedGreen || 0);
  const queueLength = Number(intersection.queueLength || 0);
  const source = intersection.vision || "CITYFLOW";

  return (
    <div className="ai-panel">
      <div className="panel-title"><i className="fas fa-brain" />AI Optimization</div>

      <div className="ai-score-box">
        <div className="ai-ring-container">
          <svg className="ai-ring-svg" viewBox="0 0 80 80">
            <circle className="ai-ring-bg" cx="40" cy="40" r="32" />
            <circle
              className="ai-ring-val"
              cx="40"
              cy="40"
              r="32"
              strokeDasharray={2 * Math.PI * 32}
              strokeDashoffset={0}
            />
          </svg>
          <div className="ai-score-text">LIVE</div>
        </div>
        <div className="ai-meta">
          <span className="ai-meta-label">Adaptive Controller</span>
          <span className="ai-meta-status">
            <i className="fas fa-check-circle" style={{ marginRight: "4px" }} />
            {source} Synced
          </span>
        </div>
      </div>

      <div className="ai-rec-box">
        <i className="fas fa-lightbulb" />
        <span>{reason}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "10px" }}>
        <div className="ai-meta-label">Green Allocation<strong style={{ display: "block", marginTop: "3px" }}>{allocatedGreen}s</strong></div>
        <div className="ai-meta-label">Estimated Queue<strong style={{ display: "block", marginTop: "3px" }}>{queueLength} vehicles</strong></div>
      </div>

      <div style={{ marginTop: "8px", fontSize: "0.72rem", opacity: 0.7 }}>
        Highest current demand: {maxLane?.direction || "N/A"}
      </div>
    </div>
  );
}
