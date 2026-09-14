import { useState } from "react";
import "./EmergencyCorridor.css";

const CITYFLOW_ROUTE = [
  { junction: "J3", phase: "NS", movement: "Southbound", road: "road_J3_J7" },
  { junction: "J7", phase: "EW", movement: "Eastbound", road: "road_J7_J8" },
  { junction: "J8", phase: "EW", movement: "Eastbound exit", road: "road_J8_V_J8_E" },
];

export default function EmergencyCorridor({ corridor, onStartCorridor, onCancelCorridor }) {
  const [vehicleType] = useState("ambulance");
  const isActive = corridor?.isActive;
  const progress = corridor?.progress || 0;
  const activeStage = Math.min(CITYFLOW_ROUTE.length - 1, Math.floor((progress / 100) * CITYFLOW_ROUTE.length));

  const handleActivate = () => {
    onStartCorridor({
      vehicleType,
      origin: "J3",
      destination: "J8",
      nodes: CITYFLOW_ROUTE.map(step => step.junction),
      roadPath: CITYFLOW_ROUTE.map(step => step.road),
      phases: CITYFLOW_ROUTE.map(step => step.phase),
    });
  };

  return (
    <div className="emergency-view">
      <div className="em-header-banner">
        <div className="em-title-box">
          <div className="em-icon-badge"><i className="fas fa-ambulance" /></div>
          <div>
            <div className="em-title">Emergency Dynamic Green Corridor</div>
            <div className="em-sub">CityFlow 8-Junction Emergency Pre-emption</div>
          </div>
        </div>
        {isActive && <div className="corridor-live-badge"><i className="fas fa-satellite-dish" /> CORRIDOR ACTIVE — SIGNALS OVERRIDDEN</div>}
      </div>

      <div className="em-grid">
        <div className="em-card">
          <div className="em-card-title"><i className="fas fa-route" />Validated CityFlow Route</div>
          <div className="corridor-status-box">
            <div className="corridor-status-header">
              <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text)" }}>J3 &rarr; J7 &rarr; J8</span>
              <span style={{ fontSize: "0.7rem", color: isActive ? "var(--green)" : "var(--text3)", fontWeight: 600 }}>
                {isActive ? `${progress}% corridor progress` : "Standby"}
              </span>
            </div>
            <div style={{ height: "4px", background: "var(--surface2)", borderRadius: "99px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #3b82f6, #10b981)", transition: "width 0.4s ease" }} />
            </div>
          </div>

          <div className="route-steps-container">
            {CITYFLOW_ROUTE.map((step, index) => {
              const cleared = isActive && index <= activeStage;
              return (
                <div key={step.junction} className={`route-step-row ${cleared ? "active-clearing" : ""}`}>
                  <div className="step-number">{index + 1}</div>
                  <div className="step-info">
                    <span className="step-name">{step.junction} · {step.movement}</span>
                    <span className="step-signal">
                      <i className="fas fa-traffic-light" style={{ color: cleared ? "var(--green)" : "var(--text3)" }} />
                      {cleared ? `FORCED ${step.phase} GREEN` : `AI CONTROL · ${step.phase}`}
                    </span>
                    <span className="step-signal" style={{ opacity: 0.7 }}>{step.road}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: "auto" }}>
            {!isActive ? (
              <button className="btn-activate-corridor" onClick={handleActivate}>
                <i className="fas fa-bolt" /> ACTIVATE J3 → J7 → J8 CORRIDOR
              </button>
            ) : (
              <button className="btn-deactivate-corridor" onClick={onCancelCorridor}>
                <i className="fas fa-power-off" /> Stand Down (Return to AI)
              </button>
            )}
          </div>
        </div>

        <div className="em-card">
          <div className="em-card-title"><i className="fas fa-traffic-light" />Signal Pre-emption Sequence</div>
          <div className="route-steps-container">
            <div className="route-step-row"><div className="step-number">1</div><div className="step-info"><span className="step-name">J3</span><span className="step-signal">NS GREEN · ambulance moves south</span></div></div>
            <div className="route-step-row"><div className="step-number">2</div><div className="step-info"><span className="step-name">J7</span><span className="step-signal">EW GREEN · ambulance turns east</span></div></div>
            <div className="route-step-row"><div className="step-number">3</div><div className="step-info"><span className="step-name">J8</span><span className="step-signal">EW GREEN · clear to east exit</span></div></div>
          </div>
          <div style={{ marginTop: "18px", padding: "12px", borderRadius: "8px", background: "var(--surface2)", fontSize: "0.75rem", color: "var(--text2)" }}>
            <strong>Road path:</strong> road_J3_J7 → road_J7_J8 → road_J8_V_J8_E
          </div>
        </div>
      </div>
    </div>
  );
}
