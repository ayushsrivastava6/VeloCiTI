"""Portotype -> CityFlow bridge for the 8-camera / 8-junction setup."""

import json
import os
import time
from datetime import datetime, timezone

import requests

PORTOTYPE_URL = os.getenv("PORTOTYPE_URL", "http://127.0.0.1:5000").rstrip("/")
CITYFLOW_URL = os.getenv("CITYFLOW_URL", "http://127.0.0.1:5002").rstrip("/")
POLL_SECONDS = float(os.getenv("VISION_POLL_SECONDS", "2"))

CAMERA_TO_JUNCTION = {
    "CAM_01": "J1",
    "CAM_02": "J2",
    "CAM_03": "J3",
    "CAM_04": "J4",
    "CAM_05": "J5",
    "CAM_06": "J6",
    "CAM_07": "J7",
    "CAM_08": "J8",
}


def _configured_map():
    """Allow an optional JSON override while keeping the 8-camera default."""
    raw = os.getenv("CAMERA_MAP_JSON")
    if not raw:
        return dict(CAMERA_TO_JUNCTION)
    try:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError
        result = dict(CAMERA_TO_JUNCTION)
        for camera_id, cfg in value.items():
            if isinstance(cfg, str):
                result[camera_id] = cfg
            elif isinstance(cfg, dict) and cfg.get("junction"):
                result[camera_id] = cfg["junction"]
        return result
    except (json.JSONDecodeError, ValueError):
        raise SystemExit("CAMERA_MAP_JSON must contain valid JSON")


def _split_phases(row):
    """Convert one camera-level observation into EW/NS demand.

    Portotype currently provides one aggregate count per camera, not
    directional counts. We therefore put the complete camera observation in
    EW and leave NS at zero. This is intentionally explicit rather than
    pretending the source has directional information it does not provide.
    """
    vehicles = max(0, int(row.get("unique_vehicles") or 0))
    speed = max(0.0, float(row.get("avg_speed") or 0.0))
    phase = {
        "vehicle_count": vehicles,
        "queue_length": 0,
        "average_speed": round(speed, 1),
        "camera_ids": [str(row.get("camera_id", ""))],
        "congestion": row.get("congestion", "UNKNOWN"),
    }
    return {"EW": phase}


def build_payload(rows, mapping):
    junctions = {}
    mapped_cameras = 0
    for row in rows:
        camera_id = str(row.get("camera_id", ""))
        junction = mapping.get(camera_id)
        if junction not in {f"J{i}" for i in range(1, 9)}:
            continue

        phases = junctions.setdefault(junction, {})
        for phase, incoming in _split_phases(row).items():
            if phase not in phases:
                phases[phase] = incoming
            else:
                phases[phase]["vehicle_count"] += incoming["vehicle_count"]
                phases[phase]["camera_ids"].extend(incoming["camera_ids"])
                count = len(phases[phase]["camera_ids"])
                phases[phase]["average_speed"] = round(
                    (phases[phase]["average_speed"] * (count - 1) + incoming["average_speed"]) / count, 1
                )
        mapped_cameras += 1

    return {
        "source": "PORTOTYPE",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "camera_count": mapped_cameras,
        "detection_count": sum(
            int(p.get("vehicle_count", 0))
            for phases in junctions.values()
            for p in phases.values()
        ),
        "junctions": junctions,
    }


def poll_once(mapping):
    response = requests.get(
        f"{PORTOTYPE_URL}/api/traffic", params={"minutes": 15}, timeout=3
    )
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list):
        raise RuntimeError("Portotype /api/traffic did not return a list")

    payload = build_payload(rows, mapping)
    target = requests.post(f"{CITYFLOW_URL}/api/vision", json=payload, timeout=3)
    target.raise_for_status()
    return payload


def main():
    mapping = _configured_map()
    print(f"Portotype bridge: {PORTOTYPE_URL} -> {CITYFLOW_URL}")
    print("Camera mapping:", ", ".join(f"{c}->{j}" for c, j in mapping.items()))
    while True:
        try:
            payload = poll_once(mapping)
            print(
                f"[vision] cameras={payload['camera_count']} "
                f"observed_vehicles={payload['detection_count']} "
                f"junctions={list(payload['junctions'])}"
            )
        except Exception as exc:
            print(f"[vision] bridge error: {exc}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
