"""
VeloCiTI cross-system integration layer.

Connects Portotype camera/ANPR traffic observations to the CityFlow
multi-agent controller. The controller is configured for eight junctions,
one per Portotype camera.
"""

from typing import Any, Dict, Optional
from agent import MultiAgentCoordinator, TrafficAgent


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


class IntegratedCoordinator(MultiAgentCoordinator):
    """Eight-junction CityFlow coordinator with Portotype observations."""

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

    def __init__(self, engine: Any):
        self.external_observations: Dict[str, Dict[str, Any]] = {}
        self.vision_metadata: Dict[str, Any] = {}
        super().__init__(engine)

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
            if len(self.message_history) > 100:
                self.message_history.pop(0)
            self.message_history.append(msg)
        decisions = {jid: agent.decide_and_act(current_broadcasts) for jid, agent in self.agents.items()}
        return {"broadcasts": current_broadcasts, "decisions": decisions, "ambulance": dict(self.ambulance), "vision": dict(self.vision_metadata)}
