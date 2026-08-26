import "./GridCell.css";

export default function GridCell({ intersection, onClick }) {
  const { name, status, vehicleCount, averageSpeed, congestionPct } = intersection;
  return (
    <div
      className={`grid-cell ${status}`}
      onClick={() => onClick(intersection)}
      title={`${name}: ${vehicleCount} vehicles, ${averageSpeed} km/h`}
    >
      <div className="cell-name">{name}</div>
      <div className="cell-data-row">
        <span className={`cell-count ${status}`}>{vehicleCount}</span>
        <span className="cell-speed">{averageSpeed} km/h</span>
      </div>
      <div className="cell-bar">
        <div className={`cell-bar-fill ${status}`} style={{ width: `${congestionPct}%` }} />
      </div>
    </div>
  );
}
