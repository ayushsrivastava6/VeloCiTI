import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { INTERSECTION_COORDS } from "../../../data/intersections";
import { getRealRoadRoute } from "../../../services/routingService";
import "./MapView.css";

// Interpolate position along an array of lat/lng coordinates based on percentage 0..100
function getInterpolatedPoint(coordsList, pct) {
  if (!coordsList || coordsList.length === 0) return [20.2961, 85.8245];
  if (coordsList.length === 1) return coordsList[0];

  const totalSegments = coordsList.length - 1;
  const currentFraction = (pct / 100) * totalSegments;
  const segIndex = Math.min(totalSegments - 1, Math.floor(currentFraction));
  const segT = currentFraction - segIndex;

  const p1 = coordsList[segIndex];
  const p2 = coordsList[segIndex + 1];

  const lat = p1[0] + (p2[0] - p1[0]) * segT;
  const lng = p1[1] + (p2[1] - p1[1]) * segT;
  return [lat, lng];
}

export default function MapView({ intersections, onSelectIntersection, corridor, onCancelCorridor }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersMapRef = useRef({});
  const corridorLayerRef = useRef(null);
  const ambulanceMarkerRef = useRef(null);
  const onSelectRef = useRef(onSelectIntersection);
  const intersectionsRef = useRef(intersections);

  const [roadGeometry, setRoadGeometry] = useState([]);
  const [roadDistance, setRoadDistance] = useState(0);

  useEffect(() => {
    onSelectRef.current = onSelectIntersection;
    intersectionsRef.current = intersections;
  }, [onSelectIntersection, intersections]);

  // 1. Initialize Map once & register global inspect callback
  useEffect(() => {
    window.__inspectIntersection = (id) => {
      const target = intersectionsRef.current.find(i => i.id === id);
      if (target) {
        onSelectRef.current?.(target);
      }
    };

    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [20.2961, 85.8245],
        zoom: 12,
        zoomControl: false,
      });

      L.control.zoom({ position: "bottomright" }).addTo(map);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> | Bhubaneswar Traffic GIS',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      delete window.__inspectIntersection;
    };
  }, []);

  // 2. Fetch OSRM Real Road Route when Corridor Activates
  useEffect(() => {
    if (corridor && corridor.isActive && corridor.nodes && corridor.nodes.length > 0) {
      const waypoints = corridor.nodes.map(n => INTERSECTION_COORDS[n] || [20.2961, 85.8245]);

      getRealRoadRoute(waypoints).then(({ roadCoords, distanceMeters }) => {
        setRoadGeometry(roadCoords);
        setRoadDistance(distanceMeters);
      });
    } else {
      setRoadGeometry([]);
      setRoadDistance(0);
    }
  }, [corridor?.isActive, corridor?.nodes]);

  // 3. Render / Update Markers stably without destroying them
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const corridorNodes = corridor?.isActive ? (corridor.nodes || []) : [];

    intersections.forEach(int => {
      if (!int.coords) return;

      const isCorridorNode = corridorNodes.includes(int.name);
      const markerClass = isCorridorNode ? "corridor-active-node" : int.status;

      let marker = markersMapRef.current[int.id];

      const statusColor = int.status === "critical" ? "#ef4444" : int.status === "medium" ? "#f59e0b" : "#10b981";
      const popupHtml = `
        <div class="map-popup-box">
          <div class="map-popup-title">${int.name}</div>
          <div class="map-popup-meta">
            <div>Status: <strong style="color:${isCorridorNode ? "#10b981" : statusColor}">${isCorridorNode ? "FORCED GREEN (CORRIDOR)" : int.status.toUpperCase()}</strong></div>
            <div>Vehicle Load: <strong>${int.vehicleCount} vehicles</strong></div>
            <div>Clearance Velocity: <strong>${int.averageSpeed} km/h</strong></div>
          </div>
          <button class="map-popup-btn" onclick="window.__inspectIntersection('${int.id}')">Inspect Node &rarr;</button>
        </div>
      `;

      if (!marker) {
        const customIcon = L.divIcon({
          className: "custom-map-icon",
          html: `<div id="pin-${int.id}" class="traffic-marker-pin ${markerClass}"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        marker = L.marker(int.coords, { icon: customIcon }).addTo(map);
        marker.bindPopup(popupHtml);
        markersMapRef.current[int.id] = marker;
      } else {
        const pinEl = document.getElementById(`pin-${int.id}`);
        if (pinEl) {
          pinEl.className = `traffic-marker-pin ${markerClass}`;
        }
        marker.setPopupContent(popupHtml);
      }
    });
  }, [intersections, corridor]);

  // 4. Render Emergency Real Road Polyline & Moving Vehicle
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clean up previous corridor layers
    if (corridorLayerRef.current) {
      map.removeLayer(corridorLayerRef.current);
      corridorLayerRef.current = null;
    }
    if (ambulanceMarkerRef.current) {
      map.removeLayer(ambulanceMarkerRef.current);
      ambulanceMarkerRef.current = null;
    }

    if (corridor && corridor.isActive && roadGeometry.length > 0) {
      // Draw Real Road Line (following streets and turns)
      const polyline = L.polyline(roadGeometry, {
        color: "#10b981",
        weight: 6,
        opacity: 0.95,
        dashArray: "10, 10",
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);
      corridorLayerRef.current = polyline;

      // Fit view to exact road route
      map.fitBounds(polyline.getBounds(), { padding: [60, 60], maxZoom: 15 });

      // Moving Vehicle Marker
      const currentPos = getInterpolatedPoint(roadGeometry, corridor.progress || 0);
      const vehicleIconHtml = corridor.vehicleType === "fire" ? "🚒" : corridor.vehicleType === "vip" ? "🚔" : "🚑";

      const vehicleMarker = L.marker(currentPos, {
        icon: L.divIcon({
          className: "ambulance-map-div-icon",
          html: `<div class="ambulance-map-marker">${vehicleIconHtml}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
        zIndexOffset: 10000,
      }).addTo(map);

      ambulanceMarkerRef.current = vehicleMarker;
    }
  }, [corridor?.isActive, roadGeometry]);

  // 5. Update vehicle position smoothly along real road turns
  useEffect(() => {
    if (corridor && corridor.isActive && ambulanceMarkerRef.current && roadGeometry.length > 0) {
      const currentPos = getInterpolatedPoint(roadGeometry, corridor.progress || 0);
      ambulanceMarkerRef.current.setLatLng(currentPos);
    }
  }, [corridor?.progress, roadGeometry]);

  const distanceKm = (roadDistance / 1000).toFixed(1);

  return (
    <div className="map-view-container">
      {/* Top Header */}
      <div className="map-overlay-header">
        <div className="map-badge-card">
          <div className="map-badge-title">
            <i className="fas fa-map-marked-alt" style={{ color: "var(--blue)" }} />
            Bhubaneswar Live Traffic GIS (GPS Heatmap)
          </div>
        </div>

        <div className="map-badge-card">
          <div className="map-legend">
            <span style={{ fontSize: "0.68rem", color: "var(--text2)" }}>
              <span className="map-leg-dot red" />Critical (&gt;280 veh)
            </span>
            <span style={{ fontSize: "0.68rem", color: "var(--text2)" }}>
              <span className="map-leg-dot amber" />Moderate
            </span>
            <span style={{ fontSize: "0.68rem", color: "var(--text2)" }}>
              <span className="map-leg-dot green" />Clear Flow
            </span>
          </div>
        </div>
      </div>

      {/* Emergency Active HUD on Map */}
      {corridor && corridor.isActive && (
        <div className="corridor-map-hud">
          {corridor.progress >= 100 ? (
            <div className="corridor-arrived-banner">
              <i className="fas fa-check-circle" style={{ fontSize: "1.1rem" }} />
              <div>DESTINATION REACHED! Unit arrived at {corridor.destination}. Releasing signals to AI...</div>
            </div>
          ) : (
            <>
              <div className="hud-top-row">
                <span className="hud-title">
                  <i className={`fas ${corridor.vehicleType === "fire" ? "fa-fire-extinguisher" : corridor.vehicleType === "vip" ? "fa-shield-alt" : "fa-ambulance"}`} />
                  EMERGENCY GREEN CORRIDOR IN TRANSIT
                </span>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <span className="hud-eta">{distanceKm} km Real Road</span>
                  <span className="hud-eta">ETA: {Math.max(1, Math.ceil((100 - corridor.progress) / 6))}s</span>
                </div>
              </div>

              <div className="hud-route">
                <strong>{corridor.origin}</strong> &rarr; <strong>{corridor.destination}</strong> ({corridor.nodes?.length} Junctions Pre-empted)
              </div>

              <div className="hud-progress-bg">
                <div className="hud-progress-fill" style={{ width: `${corridor.progress}%` }} />
              </div>

              <button className="hud-btn-cancel" onClick={onCancelCorridor}>
                <i className="fas fa-times" style={{ marginRight: "4px" }} /> Cancel Corridor
              </button>
            </>
          )}
        </div>
      )}

      <div ref={mapContainerRef} className="map-canvas" />
    </div>
  );
}
