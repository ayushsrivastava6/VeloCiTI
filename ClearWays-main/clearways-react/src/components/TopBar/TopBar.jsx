import "./TopBar.css";

const VIEW_TITLES = {
  overview:  { title:"Traffic Command Matrix",      sub:"Bhubaneswar Metropolitan Area — 10x10 Node Telemetry" },
  map:       { title:"Live Geographic GIS Map",     sub:"Bhubaneswar Arterial Road Network & Heatmap" },
  emergency: { title:"Emergency Green Corridor",    sub:"Priority Signal Pre-emption Dispatch" },
  analytics: { title:"Traffic Analytics",           sub:"Fleet distribution & congestion forecasting" },
  incidents: { title:"Incidents & Operations",      sub:"AI real-time dispatch alerts & operations log" },
  detail:    { title:"Intersection Console",        sub:"" },
};

export default function TopBar({ currentView, intersection, stats }) {
  const { title, sub } = VIEW_TITLES[currentView] || VIEW_TITLES.overview;
  const congColor = stats.avgCongestion > 70 ? "red" : stats.avgCongestion > 40 ? "amber" : "green";

  function toggleFS() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen?.();
  }

  return (
    <header className="topbar">
      <div className="tb-left">
        <h1>{currentView==="detail" && intersection ? intersection.name : title}</h1>
        <div className="tb-sub">{currentView==="detail" && intersection ? `ID: ${intersection.id}` : sub}</div>
      </div>
      <div className="tb-right">
        <div className="tb-pill">
          <span className="tb-pill-label">Congestion</span>
          <span className={`tb-pill-val ${congColor}`}>{stats.avgCongestion}%</span>
        </div>
        <div className="tb-pill">
          <span className="tb-pill-label">Avg Speed</span>
          <span className="tb-pill-val">{stats.avgSpeed} km/h</span>
        </div>
        <div className="tb-divider" />
        <button className="tb-icon-btn" onClick={toggleFS} title="Fullscreen">
          <i className="fas fa-expand" />
        </button>
      </div>
    </header>
  );
}
