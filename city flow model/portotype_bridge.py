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

CONGESTION_FACTOR = {
    "LOW": 0.10,
    "MODERATE": 0.35,
    "HIGH": 0.65,
    "SEVERE": 0.90,
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


def _camera_observation(row):
    """Build demand for exactly one camera's assigned junction.

    Portotype currently supplies an aggregate camera count rather than
    directional lane counts. We therefore keep the observation on EW only.
    Queue length is an explicitly marked *estimated* value derived from the
    camera's unique-vehicle count and reported congestion class; it is not
    presented as a direct camera measurement.
    """
    vehicles = max(0, int(row.get("unique_vehicles") or 0))
    detections = max(0, int(row.get("total_detections") or 0))
    speed = max(0.0, float(row.get("avg_speed") or 0.0))
    congestion = str(row.get("congestion") or "UNKNOWN").upper()
    factor = CONGESTION_FACTOR.get(congestion, 0.0)

    # Conservative estimated queue: congestion class determines the fraction
    # of unique vehicles considered queued. This can later be replaced by
    # lane-level queue output if Portotype exposes it.
    estimated_queue = round(vehicles * factor, 1)
    demand_score = round(min(1.0, 0.55 * min(1.0, vehicles / 100.0) + 0.45 * factor), 3)

    return {
        "vehicle_count": vehicles,
        "queue_length": estimated_queue,
        "average_speed": round(speed, 1),
        "waiting_score": round(factor, 3),
        "congestion_score_external": demand_score,
        "camera_ids": [str(row.get("camera_id", ""))],
        "camera_name": row.get("camera_name"),
        "area": row.get("area"),
        "road": row.get("road"),
        "congestion": congestion,
        "total_detections": detections,
        "queue_estimated": True,
        "source": "PORTOTYPE",
    }


def build_payload(rows, mapping):
    junctions = {}
    mapped_cameras = 0
    mapped_detections = 0

    for row in rows:
        camera_id = str(row.get("camera_id", ""))
        junction = mapping.get(camera_id)
        if junction not in {f"J{i}" for i in range(1, 9)}:
            continue

        # One camera belongs to exactly one junction. Do not merge another
        # camera's demand into this junction.
        junctions[junction] = {"EW": _camera_observation(row)}
        mapped_cameras += 1
        mapped_detections += max(0, int(row.get("total_detections") or 0))

    return {
        "source": "PORTOTYPE",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "camera_count": mapped_cameras,
        "detection_count": mapped_detections,
        "mapping": mapping,
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
                f"detections={payload['detection_count']} "
                f"junctions={list(payload['junctions'])}"
            )
        except Exception as exc:
            print(f"[vision] bridge error: {exc}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
