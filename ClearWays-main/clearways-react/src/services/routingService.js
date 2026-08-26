// Real road routing service using Open Source Routing Machine (OSRM)
export async function getRealRoadRoute(waypoints) {
  try {
    if (!waypoints || waypoints.length < 2) {
      return { roadCoords: waypoints || [], distanceMeters: 0, durationSeconds: 0 };
    }

    // OSRM expects coordinates in "lng,lat" format
    const coordsStr = waypoints.map(w => `${w[1]},${w[0]}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM HTTP error: ${res.status}`);

    const data = await res.json();
    if (data.code === "Ok" && data.routes && data.routes.length > 0) {
      const primaryRoute = data.routes[0];
      // Convert from GeoJSON [lng, lat] to Leaflet [lat, lng]
      const roadCoords = primaryRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      return {
        roadCoords,
        distanceMeters: primaryRoute.distance,
        durationSeconds: primaryRoute.duration,
      };
    }
  } catch (err) {
    console.warn("OSRM routing service unavailable, falling back to direct corridor segments:", err);
  }

  // Fallback to waypoints
  return {
    roadCoords: waypoints,
    distanceMeters: 3500,
    durationSeconds: 200,
  };
}
