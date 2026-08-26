import { Radar } from "react-chartjs-2";
import "./DetailRadar.css";

export default function DetailRadar({ intersection }) {
  const data = {
    labels: ["North", "East", "South", "West"],
    datasets: [
      {
        label: "Vehicles",
        data: intersection.lanes.map(l => l.vehicleCount),
        backgroundColor: "rgba(59, 130, 246, 0.2)",
        borderColor: "rgba(59, 130, 246, 0.9)",
        pointBackgroundColor: "#3b82f6",
        pointBorderColor: "#ffffff",
        borderWidth: 2,
        pointRadius: 3,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: {
        angleLines: { color: "rgba(51, 65, 85, 0.5)" },
        grid: { color: "rgba(51, 65, 85, 0.4)" },
        pointLabels: { color: "#94a3b8", font: { size: 10, family: "Inter" } },
        ticks: { display: false },
        beginAtZero: true,
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#0f172a",
        borderColor: "#334155",
        borderWidth: 1,
        titleColor: "#f1f5f9",
        bodyColor: "#94a3b8",
      }
    },
  };

  return (
    <div className="radar-panel">
      <div className="panel-title"><i className="fas fa-chart-area" />Lane Distribution</div>
      <div className="radar-chart-container">
        <Radar data={data} options={options} />
      </div>
    </div>
  );
}
