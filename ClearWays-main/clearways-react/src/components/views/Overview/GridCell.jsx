import "./GridCell.css";

export default function GridCell({ intersection, onClick }) {
  const { name, status, vehicleCount, averageSpeed, congestionPct } = intersection;
  const visionVehicles = Number(intersection.visionVehicleCount || vehicleCount || 0);
  const simulationVehicles = Number(intersection.simulationVehicleCount || 0);

  return (
    <div
      className={`grid-cell ${status}`}
      onClick={() => onClick(intersection)}
      title={`${name}: ${visionVehicles} camera-detected, ${simulationVehicles} simulated`}
    >
      <div className="cell-name">{name}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "10px" }}>
        <div>
          <div style={{ fontSize: "0.62rem", opacity: 0.65, textTransform: "uppercase", letterSpacing: "0.04em" }}>Camera Detected</div>
          <div className={`cell-count ${status}`}>{visionVehicles}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.62rem", opacity: 0.65, textTransform: "uppercase", letterSpacing: "0.04em" }}>Simulation</div>
          <div style={{ fontSize: "1.15rem", fontWeight: 700, marginTop: "5px" }}>{simulationVehicles}</div>
        </div>
      </div>

      <div className="cell-data-row">
        <span className="cell-speed">Vision speed: {averageSpeed} km/h</span>
      </div>
      <div className="cell-bar">
        <div className={`cell-bar-fill ${status}`} style={{ width: `${congestionPct}%` }} />
      </div>
    </div>
  );
}
