import { useState, useEffect } from "react";
import { INTERSECTION_NAMES } from "../../../data/intersections";
import "./EmergencyCorridor.css";

export default function EmergencyCorridor({ intersections, corridor, onStartCorridor, onCancelCorridor }) {
  const [origin, setOrigin] = useState("Capital Hospital");
  const [destination, setDestination] = useState("Bhubaneswar Airport");
  const [vehicleType, setVehicleType] = useState("ambulance");

  // Generate intermediate mock path
  const intermediateNodes = [
    origin,
    "Forest Park",
    "Madhusudan Nagar",
    "Gajapati Nagar",
    destination,
  ].filter((v, i, a) => a.indexOf(v) === i);

  const isActive = corridor?.isActive;
  const progress = corridor?.progress || 0;

  const handleActivate = () => {
    onStartCorridor({
      origin,
      destination,
      vehicleType,
      nodes: intermediateNodes,
    });
  };

  const currentActiveIndex = Math.min(
    intermediateNodes.length - 1,
    Math.floor((progress / 100) * intermediateNodes.length)
  );

  return (
    <div className="emergency-view">
      <div className="em-header-banner">
        <div className="em-title-box">
          <div className="em-icon-badge">
            <i className={`fas ${vehicleType === "ambulance" ? "fa-ambulance" : vehicleType === "fire" ? "fa-fire-extinguisher" : "fa-shield-alt"}`} />
          </div>
          <div>
            <div className="em-title">Emergency Dynamic Green Corridor</div>
            <div className="em-sub">Autonomous Signal Pre-emption & Priority Dispatch Protocol</div>
          </div>
        </div>
        {isActive && (
          <div className="corridor-live-badge">
            <i className="fas fa-satellite-dish" /> CORRIDOR ACTIVE — SIGNALS OVERRIDDEN
          </div>
        )}
      </div>

      <div className="em-grid">
        <div className="em-card">
          <div className="em-card-title"><i className="fas fa-sliders-h" />Corridor Parameters</div>

          <div className="em-form-group">
            <span className="em-label">Emergency Unit Category</span>
            <div className="em-type-grid">
              <button
                className={`em-type-btn ${vehicleType === "ambulance" ? "active" : ""}`}
                onClick={() => setVehicleType("ambulance")}
              >
                <i className="fas fa-ambulance" style={{ fontSize: "1rem" }} />
                Ambulance (108)
              </button>
              <button
                className={`em-type-btn ${vehicleType === "fire" ? "active" : ""}`}
                onClick={() => setVehicleType("fire")}
              >
                <i className="fas fa-fire-truck" style={{ fontSize: "1rem" }} />
                Fire Rescue
              </button>
              <button
                className={`em-type-btn ${vehicleType === "vip" ? "active" : ""}`}
                onClick={() => setVehicleType("vip")}
              >
                <i className="fas fa-shield-alt" style={{ fontSize: "1rem" }} />
                VIP Escort
              </button>
            </div>
          </div>

          <div className="em-form-group">
            <span className="em-label">Origin (Dispatch Station)</span>
            <select className="em-select" value={origin} onChange={(e) => setOrigin(e.target.value)} disabled={isActive}>
              {INTERSECTION_NAMES.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <div className="em-form-group">
            <span className="em-label">Destination (Emergency Facility)</span>
            <select className="em-select" value={destination} onChange={(e) => setDestination(e.target.value)} disabled={isActive}>
              {INTERSECTION_NAMES.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: "auto" }}>
            {!isActive ? (
              <button className="btn-activate-corridor" onClick={handleActivate}>
                <i className="fas fa-bolt" /> ACTIVATE GREEN CORRIDOR
              </button>
            ) : (
              <button className="btn-deactivate-corridor" onClick={onCancelCorridor}>
                <i className="fas fa-power-off" /> Stand Down (Deactivate Corridor)
              </button>
            )}
          </div>
        </div>

        <div className="em-card">
          <div className="em-card-title"><i className="fas fa-route" />Corridor Signal Synchronization</div>

          <div className="corridor-status-box">
            <div className="corridor-status-header">
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text)" }}>
                {origin} &rarr; {destination}
              </span>
              <span style={{ fontSize: "0.7rem", color: isActive ? "var(--green)" : "var(--text3)", fontWeight: 600 }}>
                {isActive ? `${progress}% Transit Progress (ETA 2.5m)` : "Standby"}
              </span>
            </div>

            <div style={{ height: "4px", background: "var(--surface2)", borderRadius: "99px", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, #3b82f6, #10b981)",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>

          <div className="route-steps-container">
            {intermediateNodes.map((node, index) => {
              const isCleared = isActive && index <= currentActiveIndex;
              return (
                <div key={node} className={`route-step-row ${isCleared ? "active-clearing" : ""}`}>
                  <div className="step-number">{index + 1}</div>
                  <div className="step-info">
                    <span className="step-name">{node}</span>
                    <span className="step-signal">
                      <i className="fas fa-traffic-light" style={{ color: isActive ? "var(--green)" : "var(--text3)" }} />
                      {isActive ? "FORCED GREEN (CLEAR)" : "AUTO AI"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
