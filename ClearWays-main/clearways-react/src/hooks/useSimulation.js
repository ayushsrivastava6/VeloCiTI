import { useState, useEffect, useCallback } from "react";
import { initIntersections } from "../data/intersections";

const CITYFLOW_URL = import.meta.env.VITE_CITYFLOW_URL || "http://localhost:5002";

function runLocalFallback(intersections) {
  return intersections.map(int => {
    const updatedLanes = int.lanes.map(lane => {
      if (lane.manualActive) return lane;
      return { ...lane, vehicleCount: Math.floor(Math.random() * 115) + 5, averageSpeed: Math.floor(Math.random() * 58) + 10 };
    });
    const autoLanes = updatedLanes.filter(l => !l.manualActive);
    let finalLanes = updatedLanes;
    if (autoLanes.length > 0) {
      const maxVC = Math.max(...autoLanes.map(l => l.vehicleCount));
      const avgVC = autoLanes.reduce((s, l) => s + l.vehicleCount, 0) / autoLanes.length;
      finalLanes = updatedLanes.map(lane => {
        if (lane.manualActive) return lane;
        let light = "red";
        if (lane.vehicleCount === maxVC) light = "green";
        else if (lane.vehicleCount > avgVC * 0.7) light = "yellow";
        return { ...lane, light };
      });
    }
    return deriveMetrics({ ...int, lanes: finalLanes });
  });
}

function deriveMetrics(int) {
  const totalVehicles = int.lanes.reduce((s, l) => s + Number(l.vehicleCount || 0), 0);
  const avgSpeed = Math.round(int.lanes.reduce((s, l) => s + Number(l.averageSpeed || 0), 0) / Math.max(1, int.lanes.length));
  const congestionPct = Math.min(100, Math.round((totalVehicles / (120 * 4)) * 100 * 2.5));
  const status = totalVehicles > 280 ? "critical" : totalVehicles > 130 ? "medium" : "low";
  return { ...int, vehicleCount: totalVehicles, averageSpeed: avgSpeed, congestionPct, status };
}

function applyCityFlowState(previous, state) {
  const agents = state?.agents || {};
  const ids = ["J1", "J2", "J3", "J4", "J5"];

  return previous.map((int, index) => {
    const jid = int.liveJunction || ids[index];
    const agent = agents[jid];
    if (!agent) return int;

    const ew = agent.local_obs?.EW || {};
    const ns = agent.local_obs?.NS || {};
    const current = agent.current_phase;
    const yellow = agent.is_yellow;

    // Split phase-level counts across the two displayed approaches so the
    // four-lane UI does not double-count EW/NS totals.
    const ewCount = Math.round(Number(ew.vehicle_count || 0) / 2);
    const nsCount = Math.round(Number(ns.vehicle_count || 0) / 2);
    const lanes = [
      { direction: "North", vehicleCount: nsCount, averageSpeed: Math.round(ns.average_speed || 0), light: yellow ? "yellow" : current === "NS" ? "green" : "red", manualActive: false },
      { direction: "East", vehicleCount: ewCount, averageSpeed: Math.round(ew.average_speed || 0), light: yellow ? "yellow" : current === "EW" ? "green" : "red", manualActive: false },
      { direction: "South", vehicleCount: nsCount, averageSpeed: Math.round(ns.average_speed || 0), light: yellow ? "yellow" : current === "NS" ? "green" : "red", manualActive: false },
      { direction: "West", vehicleCount: ewCount, averageSpeed: Math.round(ew.average_speed || 0), light: yellow ? "yellow" : current === "EW" ? "green" : "red", manualActive: false },
    ];

    return deriveMetrics({
      ...int,
      name: `${jid} · CityFlow`,
      liveJunction: jid,
      lanes,
      cityFlow: true,
      decisionReason: agent.decision_reason,
      allocatedGreen: agent.allocated_green,
      density: agent.overall_density,
      queueLength: agent.total_queue,
    });
  });
}

export function useSimulation() {
  const [intersections, setIntersections] = useState(() => runLocalFallback(initIntersections()));
  const [cityFlowConnected, setCityFlowConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`${CITYFLOW_URL}/api/state`, { cache: "no-store" });
        if (!response.ok) throw new Error(`CityFlow HTTP ${response.status}`);
        const state = await response.json();
        if (cancelled) return;
        setCityFlowConnected(true);
        setIntersections(prev => applyCityFlowState(prev, state));
      } catch {
        if (!cancelled) {
          setCityFlowConnected(false);
          setIntersections(prev => runLocalFallback(prev));
        }
      }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const updateLane = useCallback(async (intersectionId, direction, light) => {
    const selected = intersections.find(i => i.id === intersectionId);
    const phase = direction === "North" || direction === "South" ? 1 : 0;
    if (selected?.cityFlow && selected.liveJunction) {
      try {
        await fetch(`${CITYFLOW_URL}/api/override`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ junction: selected.liveJunction, phase }),
        });
      } catch {
        // Keep local UI responsive if the backend is temporarily unavailable.
      }
    }
    setIntersections(prev => prev.map(int => {
      if (int.id !== intersectionId) return int;
      return { ...int, lanes: int.lanes.map(l => l.direction === direction ? { ...l, light, manualActive: true } : l) };
    }));
  }, [intersections]);

  const revertLane = useCallback((intersectionId, direction) => {
    setIntersections(prev => prev.map(int => {
      if (int.id !== intersectionId) return int;
      return { ...int, lanes: int.lanes.map(l => l.direction === direction ? { ...l, light: "red", manualActive: false } : l) };
    }));
  }, []);

  const revertAll = useCallback((intersectionId) => {
    setIntersections(prev => prev.map(int => {
      if (int.id !== intersectionId) return int;
      return { ...int, lanes: int.lanes.map(l => ({ ...l, light: "red", manualActive: false })) };
    }));
  }, []);

  const liveNodes = cityFlowConnected ? intersections.filter(i => i.cityFlow) : intersections;
  const stats = {
    avgCongestion: Math.round(liveNodes.reduce((s, i) => s + i.congestionPct, 0) / Math.max(1, liveNodes.length)),
    avgSpeed: Math.round(liveNodes.reduce((s, i) => s + i.averageSpeed, 0) / Math.max(1, liveNodes.length)),
    criticalCount: liveNodes.filter(i => i.status === "critical").length,
    mediumCount: liveNodes.filter(i => i.status === "medium").length,
    clearCount: liveNodes.filter(i => i.status === "low").length,
    totalNodes: cityFlowConnected ? liveNodes.length : intersections.length,
    cityFlowConnected,
  };

  return { intersections, stats, updateLane, revertLane, revertAll, cityFlowConnected };
}
