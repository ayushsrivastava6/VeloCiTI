"""CityFlow Multi-Agent SIH Simulation Server (8-junction integration)."""
import json
import os
import threading
import time
from typing import Dict, Any
import cityflow
from flask import Flask, jsonify, request, send_from_directory
from integration import IntegratedCoordinator

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
app = Flask(__name__, static_folder=STATIC_DIR)
app.config["JSON_SORT_KEYS"] = False

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"
    return response

ctrl = {"paused": True, "step_delay": 0.10, "agent_interval": 3}
sim_state: Dict[str, Any] = {"step": 0,"running": False,"total_vehicles": 0,"avg_travel_time": 0.0,"avg_speed": 0.0,"network_density": 0.0,"total_waiting": 0,"vehicles": [],"lane_vehicles": {},"lane_waiting": {},"tl_phases": {},"agents": {},"agent_messages": [],"active_incidents": [],"ambulance": {"active": False},"vision": {"connected": False,"source": "NONE","updated_at": None}}
state_lock = threading.Lock()
eng: Any = None
coordinator: IntegratedCoordinator = None

def _init_simulation():
    global eng, coordinator
    os.chdir(BASE_DIR)
    eng = cityflow.Engine(os.path.join(BASE_DIR, "config_8j.json"), thread_num=1)
    coordinator = IntegratedCoordinator(eng)
    _refresh_state()

def _refresh_state():
    veh_ids = eng.get_vehicles(include_waiting=True)
    vehicles, speeds = [], []
    for vid in veh_ids:
        try:
            info = eng.get_vehicle_info(vid); speeds.append(float(info.get("speed", 0.0))); vehicles.append({"id": vid, **info})
        except Exception: pass
    lane_wait = eng.get_lane_waiting_vehicle_count(); lane_vehs = eng.get_lane_vehicle_count()
    total_waiting = sum(lane_wait.values()); avg_spd = round(sum(speeds)/len(speeds),1) if speeds else 0.0
    total_capacity = len(lane_vehs)*14.0; net_density = round(len(vehicles)/total_capacity*100,1) if total_capacity else 0.0
    agent_states, tl_phases = {}, {}
    for jid, agent in coordinator.agents.items():
        agent_states[jid] = agent.get_broadcast_message(); tl_phases[jid] = {"phase_idx": agent.current_phase,"phase_name": agent.phase_names[agent.current_phase],"is_yellow": agent.is_yellow}
    vision = dict(coordinator.vision_metadata); vision["connected"] = bool(coordinator.external_observations); vision["source"] = "PORTOTYPE" if coordinator.external_observations else "NONE"
    with state_lock:
        sim_state.update({"step": int(eng.get_current_time()),"running": not ctrl["paused"],"total_vehicles": len(vehicles),"avg_travel_time": round(eng.get_average_travel_time(),1),"avg_speed": avg_spd,"network_density": net_density,"total_waiting": total_waiting,"vehicles": vehicles,"lane_vehicles": lane_vehs,"lane_waiting": lane_wait,"tl_phases": tl_phases,"agents": agent_states,"agent_messages": coordinator.message_history[-15:],"active_incidents": list(coordinator.active_incidents.values()),"ambulance": dict(coordinator.ambulance),"vision": vision})

def _sim_worker():
    inner_step = 0
    while True:
        if not ctrl["paused"]:
            eng.next_step(); inner_step += 1
            v_map = {}
            for vid in eng.get_vehicles(include_waiting=True):
                try: v_map[vid] = eng.get_vehicle_info(vid)
                except Exception: pass
            if inner_step % ctrl["agent_interval"] == 0: coordinator.step(v_map)
            _refresh_state()
        time.sleep(ctrl["step_delay"])

@app.route("/")
def index(): return send_from_directory(STATIC_DIR, "index.html")
@app.route("/api/state")
def get_state():
    with state_lock: return jsonify(dict(sim_state))
@app.route("/api/roadnet")
def get_roadnet():
    with open(os.path.join(BASE_DIR, "roadnet_8j.json")) as f: return jsonify(json.load(f))
@app.route("/api/vision", methods=["POST"])
def ingest_vision():
    data = request.get_json(silent=True) or {}; junctions = data.get("junctions", {})
    if not isinstance(junctions, dict): return jsonify({"ok": False,"error": "junctions must be an object"}),400
    coordinator.set_external_observations(junctions,{"connected": True,"source": data.get("source","PORTOTYPE"),"updated_at": data.get("updated_at",time.time()),"camera_count": data.get("camera_count",0),"detection_count": data.get("detection_count",0)})
    _refresh_state(); return jsonify({"ok": True,"source": "PORTOTYPE","junctions": list(junctions.keys())})
@app.route("/api/vision", methods=["DELETE"])
def clear_vision():
    coordinator.set_external_observations({}, {"connected": False,"source": "NONE"}); _refresh_state(); return jsonify({"ok": True})
@app.route("/api/control", methods=["POST"])
def control():
    data = request.get_json() or {}; cmd = data.get("cmd")
    if cmd == "start": ctrl["paused"] = False
    elif cmd == "pause": ctrl["paused"] = True
    elif cmd == "step": ctrl["paused"] = True; eng.next_step(); _refresh_state()
    elif cmd == "reset": ctrl["paused"] = True; eng.reset(); coordinator.reset(); coordinator.set_external_observations({}, {}); _refresh_state()
    elif cmd == "speed": ctrl["step_delay"] = float(data.get("value",0.10))
    return jsonify({"ok": True})
@app.route("/api/incident", methods=["POST"])
def handle_incident():
    data=request.get_json() or {}; coordinator.set_incident(data.get("junction","J3"),data.get("road","road_J3_J2"),data.get("type","ACCIDENT"),data.get("active",True)); _refresh_state(); return jsonify({"ok":True,"incidents":list(coordinator.active_incidents.values())})
@app.route("/api/ambulance", methods=["POST"])
def handle_ambulance(): coordinator.dispatch_ambulance(); _refresh_state(); return jsonify({"ok":True,"ambulance":coordinator.ambulance})
@app.route("/api/override", methods=["POST"])
def handle_override():
    data=request.get_json() or {}; junction, phase=data.get("junction"),int(data.get("phase",0))
    if junction in coordinator.agents:
        agent=coordinator.agents[junction]; agent.current_phase=phase; agent.is_yellow=False; agent.steps_on_phase=0; eng.set_tl_phase(junction,phase); _refresh_state(); return jsonify({"ok":True})
    return jsonify({"ok":False}),400

if __name__ == "__main__":
    _init_simulation(); threading.Thread(target=_sim_worker,daemon=True).start(); print("CityFlow API: http://127.0.0.1:5002"); app.run(host="0.0.0.0",port=5002,debug=False,use_reloader=False,threaded=True)
