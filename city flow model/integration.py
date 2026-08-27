"""
VeloCiTI cross-system integration layer.

Connects Portotype's camera/ANPR traffic observations to the CityFlow
multi-agent controller without changing the underlying simulation engine.
External observations are optional; CityFlow telemetry remains the fallback.
"""

from typing import Any, Dict, Optional

from agent import MultiAgentCoordinator, TrafficAgent


class VisionTrafficAgent(TrafficAgent):
    """TrafficAgent that can consume externally observed phase telemetry."""

    def observe(self, vehicle_info_map: Dict[str, Any], external_obs: Optional[Dict[str, Any]] = None):
        obs = super().observe(vehicle_info_map)
        if not external_obs:
            return obs

        for phase_name in self.phase_names:
            incoming = external_obs.get(phase_name)
            if not isinstance(incoming, dict):
                continue

            # Portotype supplies measured traffic counts/speed. Preserve the
            # controller's waiting-time state, but replace the instantaneous
            # load signals with camera observations when available.
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
            obs[phase_name]["congestion_score"] = round(
                0.50 * density + 0.30 * queue_score + 0.20 * waiting_score, 3
            )
            obs[phase_name]["status"] = (
                "HIGH" if density > 0.55 else "MEDIUM" if density > 0.22 else "LOW"
            )
            obs[phase_name]["source"] = "PORTOTYPE"

        self.local_obs = obs
        return obs


class IntegratedCoordinator(MultiAgentCoordinator):
    """CityFlow coordinator with an optional Portotype observation feed."""

    def __init__(self, engine: Any):
        self.external_observations: Dict[str, Dict[str, Any]] = {}
        self.vision_metadata: Dict[str, Any] = {}
        super().__init__(engine)

    def _setup_network(self):
        self.agents["J1"] = VisionTrafficAgent(
            "Agent-J1", "J1", self.engine,
            {"EW": ["road_VW1_J1", "road_J3_J1"], "NS": ["road_VN1_J1", "road_VS1_J1"]},
            {"EW": "J3", "NS": None}
        )
        self.agents["J2"] = VisionTrafficAgent(
            "Agent-J2", "J2", self.engine,
            {"EW": ["road_VW2_J2", "road_VE2_J2"], "NS": ["road_VN2_J2", "road_J3_J2"]},
            {"EW": None, "NS": "J3"}
        )
        self.agents["J3"] = VisionTrafficAgent(
            "Agent-J3", "J3", self.engine,
            {"EW": ["road_J1_J3", "road_J4_J3"], "NS": ["road_J2_J3", "road_J5_J3"]},
            {"EW": "J4", "NS": "J5"}
        )
        self.agents["J4"] = VisionTrafficAgent(
            "Agent-J4", "J4", self.engine,
            {"EW": ["road_J3_J4", "road_VE4_J4"], "NS": ["road_VN4_J4", "road_VS4_J4"]},
            {"EW": "J3", "NS": None}
        )
        self.agents["J5"] = VisionTrafficAgent(
            "Agent-J5", "J5", self.engine,
            {"EW": ["road_VW5_J5", "road_VE5_J5"], "NS": ["road_J3_J5", "road_VS5_J5"]},
            {"EW": None, "NS": "J3"}
        )

    def set_external_observations(self, observations: Dict[str, Any], metadata: Optional[Dict[str, Any]] = None):
        self.external_observations = observations if isinstance(observations, dict) else {}
        self.vision_metadata = metadata if isinstance(metadata, dict) else {}

    def step(self, vehicle_info_map: Dict[str, Any]) -> Dict[str, Any]:
        self._update_ambulance()

        for jid, agent in self.agents.items():
            ext = self.external_observations.get(jid)
            agent.observe(vehicle_info_map, ext)

        current_broadcasts = {jid: agent.get_broadcast_message() for jid, agent in self.agents.items()}
        for jid, msg in current_broadcasts.items():
            if len(self.message_history) > 100:
                self.message_history.pop(0)
            self.message_history.append(msg)

        decisions = {jid: agent.decide_and_act(current_broadcasts) for jid, agent in self.agents.items()}
        return {
            "broadcasts": current_broadcasts,
            "decisions": decisions,
            "ambulance": dict(self.ambulance),
            "vision": dict(self.vision_metadata),
        }
