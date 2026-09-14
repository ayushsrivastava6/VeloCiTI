"""
VeloCiTI cross-system integration layer.

Connects Portotype camera/ANPR traffic observations to the CityFlow
multi-agent controller. The controller is configured for eight junctions,
one per Portotype camera.
"""

import time
from typing import Any, Dict, Optional
from agent import TrafficAgent


class VisionTrafficAgent(TrafficAgent):
    def observe(self, vehicle_info_map: Dict[str, Any], external_obs: Optional[Dict[str, Any]] = None):
        obs = super().observe(vehicle_info_map)
        if not external_obs:
            return obs
        for phase_name in self.phase_names:
            incoming = external_obs.get(phase_name)
            if not isinstance(incoming, dict):
                continue
            for key in ("vehicle_count", "queue_length", "average_speed"):
                if key in incoming:
                    try:
                        obs[phase_name][key] = float(incoming[key])
                    except (TypeError, ValueError):
                        pass
            total_veh = max(0.0, float(obs[phase_name].get("vehicle_count", 0)))
            queue = max(0.0, float(obs[phase_name].get("queue_length", 0)))
            capacity = max(1.0, float(obs[phase_name].get("lane_capacity", self.LANE_CAPACITY)))
            density = min(1.0, total_veh / capacity)
            queue_score = min(1.0, queue / capacity)
            waiting_score = float(obs[phase_name].get("waiting_score", 0.0))
            obs[phase_name]["density"] = round(density, 3)
            obs[phase_name]["queue_score"] = round(queue_score, 3)
            obs[phase_name]["congestion_score"] = round(0.50 * density + 0.30 * queue_score + 0.20 * waiting_score, 3)
            obs[phase_name]["status"] = "HIGH" if density > 0.55 else "MEDIUM" if density > 0.22 else "LOW"
            obs[phase_name]["source"] = "PORTOTYPE"
        self.local_obs = obs
        return obs


class IntegratedCoordinator:
    """Eight-junction coordinator with Portotype observations."""

    JUNCTIONS = {
        "J1": ({"EW": ["road_V_J1_W_J1", "road_J2_J1"], "NS": ["road_V_J1_N_J1", "road_J5_J1"]}, {"EW": "J2", "NS": "J5"}),
        "J2": ({"EW": ["road_J1_J2", "road_J3_J2"], "NS": ["road_V_J2_N_J2", "road_J6_J2"]}, {"EW": "J3", "NS": "J6"}),
        "J3": ({"EW": ["road_J2_J3", "road_J4_J3"], "NS": ["road_V_J3_N_J3", "road_J7_J3"]}, {"EW": "J4", "NS": "J7"}),
        "J4": ({"EW": ["road_J3_J4", "road_V_J4_E_J4"], "NS": ["road_V_J4_N_J4", "road_J8_J4"]}, {"EW": None, "NS": "J8"}),
        "J5": ({"EW": ["road_V_J5_W_J5", "road_J6_J5"], "NS": ["road_J1_J5", "road_V_J5_S_J5"]}, {"EW": "J6", "NS": "J1"}),
        "J6": ({"EW": ["road_J5_J6", "road_J7_J6"], "NS": ["road_J2_J6", "road_V_J6_S_J6"]}, {"EW": "J7", "NS": "J2"}),
        "J7": ({"EW": ["road_J6_J7", "road_J8_J7"], "NS": ["road_J3_J7", "road_V_J7_S_J7"]}, {"EW": "J8", "NS": "J3"}),
        "J8": ({"EW": ["road_J7_J8", "road_V_J8_E_J8"], "NS": ["road_J4_J8", "road_V_J8_S_J8"]}, {"EW": None, "NS": "J4"}),
    }

    # Demo emergency corridor following the actual 2x4 CityFlow layout:
    # J3 -> J7 is southbound (NS), then J7 -> J8 is eastbound (EW).
    # J8 keeps the eastbound phase green while the ambulance clears the
    # final junction toward the virtual east exit.
    AMBULANCE_CORRIDOR = [("J3", "NS"), ("J7", "EW"), ("J8", "EW")]
    AMBULANCE_ROAD_PATH = ["road_J3_J7", "road_J7_J8"]
    AMBULANCE_STAGE_SECONDS = 20

    def __init__(self, engine: Any):
        self.engine = engine
        self.agents: Dict[str, VisionTrafficAgent] = {}
        self.external_observations: Dict[str, Dict[str, Any]] = {}
        self.vision_metadata: Dict[str, Any] = {}
        self.message_history = []
        self.active_incidents: Dict[str, Any] = {}
        self.ambulance = {"active": False}
        self._ambulance_stage = 0
        self._ambulance_stage_started = None
        self.AMBULANCE_CORRIDOR_ACTIVE = list(self.AMBULANCE_CORRIDOR)
        self._setup_network()

    def _setup_network(self):
        for jid, (incoming, neighbors) in self.JUNCTIONS.items():
            self.agents[jid] = VisionTrafficAgent(f"Agent-{jid}", jid, self.engine, incoming, neighbors)

    def set_external_observations(self, observations: Dict[str, Any], metadata: Optional[Dict[str, Any]] = None):
        self.external_observations = observations if isinstance(observations, dict) else {}
        self.vision_metadata = metadata if isinstance(metadata, dict) else {}

    def step(self, vehicle_info_map: Dict[str, Any]) -> Dict[str, Any]:
        self._update_ambulance()
        for jid, agent in self.agents.items():
            agent.observe(vehicle_info_map, self.external_observations.get(jid))
        current_broadcasts = {jid: agent.get_broadcast_message() for jid, agent in self.agents.items()}
        for msg in current_broadcasts.values():
            self.message_history.append(msg)
        self.message_history = self.message_history[-100:]
        decisions = {jid: agent.decide_and_act(current_broadcasts) for jid, agent in self.agents.items()}
        return {"broadcasts": current_broadcasts, "decisions": decisions, "ambulance": dict(self.ambulance), "vision": dict(self.vision_metadata)}

    def set_incident(self, junction: str, road: str, incident_type: str, active: bool = True):
        if junction not in self.agents:
            return
        self.agents[junction].set_incident(road, incident_type, active)
        key = f"{junction}:{road}"
        if active:
            self.active_incidents[key] = {"junction": junction, "road": road, "type": incident_type, "active": True, "timestamp": time.time()}
        else:
            self.active_incidents.pop(key, None)

    def dispatch_ambulance(self, start_junction: str = "J3", phase: str = "NS"):
        """Start the physical CityFlow corridor represented by the 8-junction road layout."""
        if start_junction not in self.agents:
            start_junction = "J3"
        if phase not in self.agents[start_junction].phase_names:
            phase = "NS"

        # The default corridor is the validated J3 -> J7 -> J8 route.
        corridor = list(self.AMBULANCE_CORRIDOR)
        if (start_junction, phase) in corridor:
            start_index = corridor.index((start_junction, phase))
        else:
            corridor.insert(0, (start_junction, phase))
            start_index = 0

        for agent in self.agents.values():
            agent.set_emergency(None)

        self.AMBULANCE_CORRIDOR_ACTIVE = corridor
        self._ambulance_stage = start_index
        self._ambulance_stage_started = time.time()

        jid, corridor_phase = corridor[self._ambulance_stage]
        self.agents[jid].set_emergency(corridor_phase)
        self.ambulance = {
            "active": True,
            "junction": jid,
            "phase": corridor_phase,
            "stage": self._ambulance_stage + 1,
            "total_stages": len(corridor),
            "route": [item[0] for item in corridor],
            "road_path": list(self.AMBULANCE_ROAD_PATH),
            "route_description": "J3 → J7 → J8",
            "timestamp": time.time(),
        }

    def cancel_ambulance(self):
        """Release emergency pre-emption and return all junctions to AI control."""
        for agent in self.agents.values():
            agent.set_emergency(None)
        self._ambulance_stage = 0
        self._ambulance_stage_started = None
        self.AMBULANCE_CORRIDOR_ACTIVE = list(self.AMBULANCE_CORRIDOR)
        self.ambulance = {"active": False, "cancelled": True, "timestamp": time.time()}

    def _update_ambulance(self):
        """Move emergency priority to the next junction and finish cleanly."""
        if not self.ambulance.get("active") or self._ambulance_stage_started is None:
            return

        if time.time() - self._ambulance_stage_started < self.AMBULANCE_STAGE_SECONDS:
            return

        corridor = self.AMBULANCE_CORRIDOR_ACTIVE
        current_junction, _ = corridor[self._ambulance_stage]
        self.agents[current_junction].set_emergency(None)
        self._ambulance_stage += 1

        if self._ambulance_stage >= len(corridor):
            self.ambulance = {"active": False, "completed": True, "route": [item[0] for item in corridor], "road_path": list(self.AMBULANCE_ROAD_PATH), "route_description": "J3 → J7 → J8", "timestamp": time.time()}
            self._ambulance_stage_started = None
            return

        next_junction, next_phase = corridor[self._ambulance_stage]
        self.agents[next_junction].set_emergency(next_phase)
        self._ambulance_stage_started = time.time()
        self.ambulance = {
            "active": True,
            "junction": next_junction,
            "phase": next_phase,
            "stage": self._ambulance_stage + 1,
            "total_stages": len(corridor),
            "route": [item[0] for item in corridor],
            "road_path": list(self.AMBULANCE_ROAD_PATH),
            "route_description": "J3 → J7 → J8",
            "timestamp": time.time(),
        }

    def reset(self):
        for agent in self.agents.values():
            agent.reset()
            agent.incidents.clear()
            agent.set_emergency(None)
        self.external_observations = {}
        self.vision_metadata = {}
        self.message_history = []
        self.active_incidents = {}
        self.ambulance = {"active": False}
        self._ambulance_stage = 0
        self._ambulance_stage_started = None
        self.AMBULANCE_CORRIDOR_ACTIVE = list(self.AMBULANCE_CORRIDOR)
