import { useState, useCallback, useEffect } from "react";
import { useSimulation } from "./hooks/useSimulation";
import { useClock } from "./hooks/useClock";
import Sidebar from "./components/Sidebar/Sidebar";
import TopBar from "./components/TopBar/TopBar";
import Overview from "./components/views/Overview/Overview";
import DetailView from "./components/views/DetailView/DetailView";
import MapView from "./components/views/MapView/MapView";
import EmergencyCorridor from "./components/views/Emergency/EmergencyCorridor";
import Analytics from "./components/views/Analytics/Analytics";
import Incidents from "./components/views/Incidents/Incidents";
import LoadingScreen from "./components/common/LoadingScreen/LoadingScreen";
import "./App.css";

const CITYFLOW_URL = import.meta.env.VITE_CITYFLOW_URL || "http://localhost:5002";
const DEFAULT_AMBULANCE_ROUTE = {
  nodes: ["J3", "J7", "J8"],
  roadPath: ["road_J3_J7", "road_J7_J8", "road_J8_V_J8_E"],
  phases: ["NS", "EW", "EW"],
};

export default function App() {
  const [view, setView] = useState("overview");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [corridor, setCorridor] = useState({
    isActive: false,
    origin: "J3",
    destination: "J8",
    vehicleType: "ambulance",
    nodes: DEFAULT_AMBULANCE_ROUTE.nodes,
    roadPath: DEFAULT_AMBULANCE_ROUTE.roadPath,
    phases: DEFAULT_AMBULANCE_ROUTE.phases,
    progress: 0,
  });

  const { intersections, stats, updateLane, revertLane, revertAll } = useSimulation();
  const { time, date } = useClock();

  useEffect(() => {
    if (!corridor.isActive) return undefined;
    const timer = setInterval(() => {
      setCorridor(prev => {
        if (!prev.isActive) return prev;
        const next = Math.min(100, prev.progress + (100 / 60));
        if (next >= 100) return { ...prev, progress: 100, isActive: false };
        return { ...prev, progress: next };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [corridor.isActive]);

  const selectedIntersection = intersections.find(i => i.id === selectedId) || null;

  function handleCellClick(int) { setSelectedId(int.id); setView("detail"); }
  function handleBack() { setView("overview"); setSelectedId(null); }
  function handleNav(v) { setView(v); if (v !== "detail") setSelectedId(null); }

  const handleStartCorridor = useCallback(async (config) => {
    const route = DEFAULT_AMBULANCE_ROUTE;
    try {
      const response = await fetch(`${CITYFLOW_URL}/api/ambulance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_junction: route.nodes[0], phase: route.phases[0] }),
      });
      const result = await response.json();
      const ambulance = result?.ambulance || {};
      setCorridor({
        ...config,
        isActive: Boolean(ambulance.active),
        origin: route.nodes[0],
        destination: route.nodes[route.nodes.length - 1],
        nodes: route.nodes,
        roadPath: ambulance.road_path || route.roadPath,
        phases: route.phases,
        progress: 0,
      });
      setView("emergency");
    } catch {
      setCorridor(prev => ({ ...prev, ...config, isActive: false, progress: 0 }));
    }
  }, []);

  const handleCancelCorridor = useCallback(async () => {
    try { await fetch(`${CITYFLOW_URL}/api/ambulance`, { method: "DELETE" }); } catch {}
    setCorridor(prev => ({ ...prev, isActive: false, progress: 0 }));
  }, []);

  const handleLoadingComplete = useCallback(() => setLoading(false), []);

  if (loading) return <LoadingScreen onComplete={handleLoadingComplete} />;

  return (
    <div className="app">
      <Sidebar currentView={view} onNav={handleNav} time={time} date={date} stats={stats} />
      <div className="app-main">
        <TopBar currentView={view} intersection={selectedIntersection} stats={stats} />
        <div className="app-content">
          {view === "overview" && <Overview intersections={intersections} stats={stats} onCellClick={handleCellClick} />}
          {view === "map" && <MapView intersections={intersections} onSelectIntersection={handleCellClick} corridor={corridor} onCancelCorridor={handleCancelCorridor} />}
          {view === "emergency" && <EmergencyCorridor intersections={intersections} corridor={corridor} onStartCorridor={handleStartCorridor} onCancelCorridor={handleCancelCorridor} />}
          {view === "detail" && selectedIntersection && <DetailView intersection={selectedIntersection} onBack={handleBack} onUpdateLane={updateLane} onRevertLane={revertLane} onRevertAll={revertAll} />}
          {view === "analytics" && <Analytics intersections={intersections} />}
          {view === "incidents" && <Incidents intersections={intersections} />}
        </div>
      </div>
    </div>
  );
}
