import { useState, useEffect, useCallback } from "react";
import { initIntersections } from "../data/intersections";

const CITYFLOW_URL = import.meta.env.VITE_CITYFLOW_URL || "http://localhost:5002";
const CITYFLOW_JUNCTIONS = ["J1", "J2", "J3", "J4", "J5", "J6", "J7", "J8"];

function makeInitialIntersections() {
  return initIntersections().slice(0, CITYFLOW_JUNCTIONS.length).map((int, index) => ({
    ...int,
    liveJunction: CITYFLOW_JUNCTIONS[index],
    name: `${CITYFLOW_JUNCTIONS[index]} · CityFlow`,
  }));
}

function deriveMetrics(int) {
  const totalVehicles = int.lanes.reduce((s, l) => s + Number(l.vehicleCount || 0), 0);
  const avgSpeed = Math.round(int.lanes.reduce((s, l) => s + Number(l.averageSpeed || 0), 0) / Math.max(1, int.lanes.length));
  const congestionPct = Math.min(100, Math.round((Number(int.density || 0) || 0) * 100));
  const status = congestionPct >= 70 ? "critical" : congestionPct >= 35 ? "medium" : "low";
  return { ...int, vehicleCount: totalVehicles, averageSpeed: avgSpeed, congestionPct, status };
}

function applyCityFlowState(state) {
  const agents = state?.agents || {};
  return CITYFLOW_JUNCTIONS.map((jid, index) => {
    const base = makeInitialIntersections()[index];
    const agent = agents[jid];
    if (!agent) return deriveMetrics(base);
    const ew = agent.local_obs?.EW || {};
    const ns = agent.local_obs?.NS || {};
    const current = agent.current_phase;
    const yellow = Boolean(agent.is_yellow);
    const nsLight = yellow ? "yellow" : current === "NS" ? "green" : "red";
    const ewLight = yellow ? "yellow" : current === "EW" ? "green" : "red";
    const ewCount = Math.max(0, Math.round(Number(ew.vehicle_count || 0) / 2));
    const nsCount = Math.max(0, Math.round(Number(ns.vehicle_count || 0) / 2));
    const ewSpeed = Math.round(Number(ew.average_speed || 0));
    const nsSpeed = Math.round(Number(ns.average_speed || 0));
    return deriveMetrics({
      ...base,
      name: `${jid} · CityFlow`, liveJunction: jid,
      lanes: [
        { direction: "North", vehicleCount: nsCount, averageSpeed: nsSpeed, light: nsLight, manualActive: false },
        { direction: "East", vehicleCount: ewCount, averageSpeed: ewSpeed, light: ewLight, manualActive: false },
        { direction: "South", vehicleCount: nsCount, averageSpeed: nsSpeed, light: nsLight, manualActive: false },
        { direction: "West", vehicleCount: ewCount, averageSpeed: ewSpeed, light: ewLight, manualActive: false },
      ],
      cityFlow: true,
      decisionReason: agent.decision_reason,
      allocatedGreen: Number(agent.allocated_green || 0),
      stepsOnPhase: Number(agent.steps_on_phase || 0),
      yellowRemaining: Number(agent.yellow_remaining || 0),
      currentPhase: agent.current_phase,
      phaseIndex: Number(agent.phase_idx || 0),
      isYellow: yellow,
      density: Number(agent.overall_density || 0),
      queueLength: Number(agent.total_queue || 0),
      vision: agent.local_obs?.EW?.source || agent.local_obs?.NS?.source,
      cameraCount: state?.vision?.camera_count,
    });
  });
}

export function useSimulation() {
  const [intersections, setIntersections] = useState(makeInitialIntersections);
  const [cityFlowConnected, setCityFlowConnected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`${CITYFLOW_URL}/api/state`, { cache: "no-store" });
        if (!response.ok) throw new Error(`CityFlow HTTP ${response.status}`);
        const state = await response.json();
        if (cancelled) return;
        setCityFlowConnected(true); setIntersections(applyCityFlowState(state));
      } catch { if (!cancelled) setCityFlowConnected(false); }
    };
    poll(); const id = setInterval(poll, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  const updateLane = useCallback(async (intersectionId, direction, light) => {
    const selected = intersections.find(i => i.id === intersectionId);
    const phase = direction === "North" || direction === "South" ? 1 : 0;
    if (selected?.cityFlow && selected.liveJunction) {
      try { await fetch(`${CITYFLOW_URL}/api/override`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ junction: selected.liveJunction, phase }) }); } catch {}
    }
    setIntersections(prev => prev.map(int => int.id !== intersectionId ? int : { ...int, lanes: int.lanes.map(l => l.direction === direction ? { ...l, light, manualActive: true } : l) }));
  }, [intersections]);
  const revertLane = useCallback((intersectionId, direction) => setIntersections(prev => prev.map(int => int.id !== intersectionId ? int : { ...int, lanes: int.lanes.map(l => l.direction === direction ? { ...l, manualActive: false } : l) })), []);
  const revertAll = useCallback((intersectionId) => setIntersections(prev => prev.map(int => int.id !== intersectionId ? int : { ...int, lanes: int.lanes.map(l => ({ ...l, manualActive: false })) })), []);
  const liveNodes = intersections;
  const stats = {
    avgCongestion: Math.round(liveNodes.reduce((s, i) => s + i.congestionPct, 0) / Math.max(1, liveNodes.length)),
    avgSpeed: Math.round(liveNodes.reduce((s, i) => s + i.averageSpeed, 0) / Math.max(1, liveNodes.length)),
    criticalCount: liveNodes.filter(i => i.status === "critical").length,
    mediumCount: liveNodes.filter(i => i.status === "medium").length,
    clearCount: liveNodes.filter(i => i.status === "low").length,
    totalNodes: liveNodes.length, cityFlowConnected,
  };
  return { intersections, stats, updateLane, revertLane, revertAll, cityFlowConnected };
}
