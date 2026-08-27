"""
Portotype -> CityFlow bridge.

Polls Portotype's traffic API and forwards normalized observations to the
CityFlow /api/vision endpoint. Camera-to-junction/phase mapping is explicit
so no geographic assumptions are silently made.

Defaults match the current repository servers:
  PORTOTYPE_URL=http://127.0.0.1:5000
  CITYFLOW_URL=http://127.0.0.1:5002
  VISION_POLL_SECONDS=2
  CAMERA_MAP_JSON='{"CAM_J1_EW":{"junction":"J1","phase":"EW"}}'

Camera rows can also be auto-mapped when their camera id/name/road contains
patterns such as J1 + EW, J2 + NS, etc. Use CAMERA_MAP_JSON for real cameras.
"""

import json
import os
import re
import time
from datetime import datetime, timezone

import requests

PORTOTYPE_URL = os.getenv("PORTOTYPE_URL", "http://127.0.0.1:5000").rstrip("/")
CITYFLOW_URL = os.getenv("CITYFLOW_URL", "http://127.0.0.1:5002").rstrip("/")
POLL_SECONDS = float(os.getenv("VISION_POLL_SECONDS", "2"))


def _configured_map():
    raw = os.getenv("CAMERA_MAP_JSON", "{}")
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        raise SystemExit("CAMERA_MAP_JSON must contain valid JSON")


def _infer_mapping(row):
    text = " ".join(str(row.get(k, "")) for k in ("camera_id", "camera_name", "road")).upper()
    junction = next((f"J{i}" for i in range(1, 6) if re.search(rf"\bJ{i}\b", text)), None)
    phase = "NS" if re.search(r"\b(NS|NORTH|SOUTH)\b", text) else "EW" if re.search(r"\b(EW|EAST|WEST)\b", text) else None
    return junction, phase


def build_payload(rows, mapping):
    junctions = {}
    mapped_cameras = 0
    for row in rows:
        camera_id = str(row.get("camera_id", ""))
        cfg = mapping.get(camera_id)
        if cfg:
            junction, phase = cfg.get("junction"), cfg.get("phase")
        else:
            junction, phase = _infer_mapping(row)

        if junction not in {f"J{i}" for i in range(1, 6)} or phase not in {"EW", "NS"}:
            continue

        bucket = junctions.setdefault(junction, {}).setdefault(phase, {
            "vehicle_count": 0, "queue_length": 0, "average_speed": 0.0, "camera_ids": []
        })
        bucket["vehicle_count"] += int(row.get("unique_vehicles") or 0)
        bucket["average_speed"] += float(row.get("avg_speed") or 0.0)
        bucket["camera_ids"].append(camera_id)
        mapped_cameras += 1

    for phases in junctions.values():
        for data in phases.values():
            n = max(1, len(data["camera_ids"]))
            data["average_speed"] = round(data["average_speed"] / n, 1)

    return {
        "source": "PORTOTYPE",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "camera_count": mapped_cameras,
        "detection_count": sum(int(p.get("vehicle_count", 0)) for phases in junctions.values() for p in phases.values()),
        "junctions": junctions,
    }


def poll_once(mapping):
    response = requests.get(f"{PORTOTYPE_URL}/api/traffic", params={"minutes": 15}, timeout=3)
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
    while True:
        try:
            payload = poll_once(mapping)
            print(f"[vision] cameras={payload['camera_count']} observed_vehicles={payload['detection_count']} junctions={list(payload['junctions'])}")
        except Exception as exc:
            print(f"[vision] bridge error: {exc}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
