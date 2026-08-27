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

const CITYFLOW_URL = import.meta.env.VITE_CITYFLOW_URL || "http://localhost:5000";

export default function App() {
  const [view, setView] = useState("overview");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [corridor, setCorridor] = useState({
    isActive: false,
    origin: "Capital Hospital",
    destination: "Bhubaneswar Airport",
    vehicleType: "ambulance",
    nodes: [],
    progress: 0,
  });

  const { intersections, stats, updateLane, revertLane, revertAll } = useSimulation();
  const { time, date } = useClock();

  useEffect(() => {
    let timer = null;
    if (corridor.isActive) {
      timer = setInterval(() => {
        setCorridor(prev => {
          if (!prev.isActive) return prev;
          if (prev.progress >= 100) {
            clearInterval(timer);
            setTimeout(() => {
              setCorridor(c => ({ ...c, isActive: false, progress: 0 }));
            }, 2500);
            return { ...prev, progress: 100 };
          }
          return { ...prev, progress: Math.min(100, prev.progress + 3) };
        });
      }, 400);
    }
    return () => clearInterval(timer);
  }, [corridor.isActive]);

  const selectedIntersection = intersections.find(i => i.id === selectedId) || null;

  function handleCellClick(int) { setSelectedId(int.id); setView("detail"); }
  function handleBack() { setView("overview"); setSelectedId(null); }
  function handleNav(v) { setView(v); if (v !== "detail") setSelectedId(null); }

  const handleStartCorridor = useCallback((config) => {
    setCorridor({ ...config, isActive: true, progress: 0 });
    fetch(`${CITYFLOW_URL}/api/ambulance`, { method: "POST" }).catch(() => {});
    setView("map");
  }, []);

  const handleCancelCorridor = useCallback(() => {
    setCorridor(prev => ({ ...prev, isActive: false, progress: 0 }));
    // The CityFlow ambulance completes automatically; this keeps the UI action local.
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
          {view === "map" && (
            <MapView
              intersections={intersections}
              onSelectIntersection={handleCellClick}
              corridor={corridor}
              onCancelCorridor={handleCancelCorridor}
            />
          )}
          {view === "emergency" && (
            <EmergencyCorridor
              intersections={intersections}
              corridor={corridor}
              onStartCorridor={handleStartCorridor}
              onCancelCorridor={handleCancelCorridor}
            />
          )}
          {view === "detail" && selectedIntersection && (
            <DetailView
              intersection={selectedIntersection}
              onBack={handleBack}
              onUpdateLane={updateLane}
              onRevertLane={revertLane}
              onRevertAll={revertAll}
            />
          )}
          {view === "analytics" && <Analytics intersections={intersections} />}
          {view === "incidents" && <Incidents intersections={intersections} />}
        </div>
      </div>
    </div>
  );
}
