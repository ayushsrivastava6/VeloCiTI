import "./SignalStatus.css";

export default function SignalStatus({ intersection }) {
  const greenLanes = intersection.lanes.filter(l => l.light === "green").map(l => l.direction);
  const hasGreen = greenLanes.length > 0;
  const hasYellow = intersection.lanes.some(l => l.light === "yellow");

  const allocatedGreen = Math.max(1, Number(intersection.allocatedGreen || 30));
  const stepsOnPhase = Math.max(0, Number(intersection.stepsOnPhase || 0));
  const yellowRemaining = Math.max(0, Number(intersection.yellowRemaining || 0));
  const countdown = hasYellow
    ? yellowRemaining
    : Math.max(0, Math.ceil(allocatedGreen - stepsOnPhase));
  const totalPhaseTime = hasYellow ? 3 : allocatedGreen;
  const progress = Math.min(100, Math.max(0, (countdown / Math.max(1, totalPhaseTime)) * 100));

  const phase = hasYellow
    ? "Yellow Clearance"
    : hasGreen
      ? `${greenLanes.join(" + ")} Green`
      : "All Red";

  return (
    <div className="signal-panel">
      <div className="panel-title"><i className="fas fa-traffic-light" />Signal Status</div>
      <div className="signal-body">
        <div className="signal-pole">
          <div className="signal-housing">
            <div className={`signal-light ${!hasGreen && !hasYellow ? "red-on" : ""}`} />
            <div className={`signal-light ${hasYellow ? "amber-on" : ""}`} />
            <div className={`signal-light ${hasGreen ? "green-on" : ""}`} />
          </div>
          <div className="signal-post" />
        </div>
        <div className="signal-meta">
          <div className="signal-phase">{phase}</div>
          <div className="signal-countdown">{countdown}s</div>
          <div className="signal-bar">
            <div className="signal-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <div style={{ marginTop: "5px", fontSize: "0.65rem", opacity: 0.6 }}>
            {hasYellow ? "CityFlow clearance interval" : `AI allocation: ${allocatedGreen}s`}
          </div>
        </div>
      </div>
    </div>
  );
}
