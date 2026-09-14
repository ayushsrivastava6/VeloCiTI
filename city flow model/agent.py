"""
agent.py — Distributed Multi-Agent Traffic Light Control System
================================================================
"""

import time
from typing import Dict, List, Any, Optional


class TrafficAgent:
    LANE_CAPACITY = 14.0
    MIN_GREEN = 12
    MAX_GREEN = 45
    YELLOW_TIME = 3
    STARVATION_LIMIT = 40
    SWITCH_RATIO = 1.30

    def __init__(
        self,
        agent_id: str,
        junction_id: str,
        engine: Any,
        incoming_roads: Dict[str, List[str]],
        outgoing_neighbors: Dict[str, Optional[str]]
    ):
        self.agent_id = agent_id
        self.junction_id = junction_id
        self.engine = engine
        self.incoming_roads = incoming_roads
        self.outgoing_neighbors = outgoing_neighbors
        self.phase_names = list(incoming_roads.keys())
        self.current_phase = 0
        self.is_yellow = False
        self.yellow_timer = 0
        self.target_phase = 0
        self.steps_on_phase = 0
        self.allocated_green = self.MIN_GREEN
        self.waiting_time_tracker = {p: 0 for p in self.phase_names}
        self.local_obs = {}
        self.congestion_scores = {}
        self.priorities = {}
        self.last_decision_reason = "System Initialized."
        self.incidents: Dict[str, Any] = {}
        self.emergency_override: Optional[str] = None
        self.step_counter = 0

    def observe(self, vehicle_info_map: Dict[str, Any]) -> Dict[str, Any]:
        lane_waiting = self.engine.get_lane_waiting_vehicle_count()
        lane_vehicles = self.engine.get_lane_vehicle_count()
        obs = {}
        for phase_name, roads in self.incoming_roads.items():
            total_veh = 0
            waiting_veh = 0
            speeds = []
            for r in roads:
                lane_id = f"{r}_0"
                waiting_veh += lane_waiting.get(lane_id, 0)
                total_veh += lane_vehicles.get(lane_id, 0)
            for v_data in vehicle_info_map.values():
                if v_data.get("road") in roads:
                    try:
                        speeds.append(float(v_data.get("speed", 0.0)))
                    except (ValueError, TypeError):
                        pass
            avg_speed = round(sum(speeds) / len(speeds), 1) if speeds else 16.67
            total_cap = len(roads) * self.LANE_CAPACITY
            density = min(1.0, round(total_veh / total_cap, 3))
            queue_score = min(1.0, round(waiting_veh / total_cap, 3))
            is_active = (self.phase_names[self.current_phase] == phase_name and not self.is_yellow)
            if is_active:
                self.waiting_time_tracker[phase_name] = max(0, self.waiting_time_tracker[phase_name] - 2)
            elif waiting_veh > 0:
                self.waiting_time_tracker[phase_name] += 1
            else:
                self.waiting_time_tracker[phase_name] = 0
            wait_sec = self.waiting_time_tracker[phase_name]
            waiting_score = min(1.0, round(wait_sec / self.STARVATION_LIMIT, 3))
            cong_score = round(0.50 * density + 0.30 * queue_score + 0.20 * waiting_score, 3)
            obs[phase_name] = {
                "vehicle_count": total_veh,
                "queue_length": waiting_veh,
                "average_speed": avg_speed,
                "lane_capacity": total_cap,
                "density": density,
                "queue_score": queue_score,
                "waiting_time": wait_sec,
                "waiting_score": waiting_score,
                "congestion_score": cong_score,
                "status": "HIGH" if density > 0.55 else "MEDIUM" if density > 0.22 else "LOW"
            }
        self.local_obs = obs
        return obs

    def compute_priority(self, phase_name: str, neighbor_states: Dict[str, Any]) -> float:
        obs = self.local_obs.get(phase_name, {})
        local_cong = obs.get("congestion_score", 0.0)
        neighbor_id = self.outgoing_neighbors.get(phase_name)
        downstream_density = 0.0
        has_incident = False
        if neighbor_id and neighbor_id in neighbor_states:
            n_data = neighbor_states[neighbor_id]
            downstream_density = n_data.get("overall_density", 0.0)
            if n_data.get("incident_active"):
                has_incident = True
        for inc in self.incidents.values():
            if inc.get("active"):
                has_incident = True
        downstream_cap_factor = 0.05 if has_incident else max(0.20, 1.0 - downstream_density)
        priority = local_cong * downstream_cap_factor
        wait_time = obs.get("waiting_time", 0)
        if wait_time > self.STARVATION_LIMIT:
            priority += min(0.6, (wait_time - self.STARVATION_LIMIT) / self.STARVATION_LIMIT * 0.5)
        if self.emergency_override == phase_name:
            priority += 8.0
        return round(priority, 3)

    def decide_and_act(self, neighbor_states: Dict[str, Any]) -> str:
        self.step_counter += 1
        if self.is_yellow:
            self.yellow_timer -= 1
            if self.yellow_timer <= 0:
                self.is_yellow = False
                self.current_phase = self.target_phase
                self.steps_on_phase = 0
                self.engine.set_tl_phase(self.junction_id, self.current_phase)
                new_name = self.phase_names[self.current_phase]
                self.last_decision_reason = f"Green activated for {new_name} ({self.allocated_green}s allocated)."
                return self.last_decision_reason
            self.last_decision_reason = f"Yellow clearance interval ({self.yellow_timer}s remaining)."
            return self.last_decision_reason
        self.steps_on_phase += 1
        priorities = {p: self.compute_priority(p, neighbor_states) for p in self.phase_names}
        self.priorities = priorities
        cur_phase_name = self.phase_names[self.current_phase]
        other_phase_idx = 1 - self.current_phase
        other_phase_name = self.phase_names[other_phase_idx]
        cur_priority = priorities.get(cur_phase_name, 0.0)
        other_priority = priorities.get(other_phase_name, 0.0)
        active_inc = [i for i in self.incidents.values() if i.get("active")]
        if active_inc:
            inc_info = active_inc[0]
            if cur_phase_name == "NS" and other_priority > 0.05 and self.steps_on_phase >= self.MIN_GREEN:
                self._initiate_switch(other_phase_idx, other_priority, f"⚠️ Accident throttling on {cur_phase_name}")
                return self.last_decision_reason
            if cur_phase_name == "NS":
                self.last_decision_reason = f"⚠️ ACCIDENT ALERT on {inc_info.get('road')}: Downstream capacity 5%. Throttling arrival flow!"
                return self.last_decision_reason
        if self.emergency_override:
            if self.emergency_override != cur_phase_name:
                self._initiate_switch(other_phase_idx, 1.0, "🚨 Emergency Ambulance Corridor Preemption")
                return self.last_decision_reason
            self.last_decision_reason = "🚨 Holding GREEN for Ambulance Corridor."
            return self.last_decision_reason
        if self.steps_on_phase < self.MIN_GREEN:
            self.last_decision_reason = f"Holding {cur_phase_name}-Green (Min hold: {self.MIN_GREEN - self.steps_on_phase}s left)."
            return self.last_decision_reason
        if self.steps_on_phase >= self.MAX_GREEN:
            self._initiate_switch(other_phase_idx, other_priority, "Max green duration reached")
            return self.last_decision_reason
        other_wait = self.local_obs.get(other_phase_name, {}).get("waiting_time", 0)
        if other_wait > self.STARVATION_LIMIT and other_priority > cur_priority:
            self._initiate_switch(other_phase_idx, other_priority, f"Starvation prevented ({other_phase_name} waited {other_wait}s)")
            return self.last_decision_reason
        if other_priority > cur_priority * self.SWITCH_RATIO and other_priority > 0.18:
            neighbor = self.outgoing_neighbors.get(cur_phase_name)
            reason = f"Higher load on {other_phase_name} (P={other_priority} vs {cur_priority})"
            if neighbor and neighbor in neighbor_states:
                n_cap = 1.0 - neighbor_states[neighbor].get("overall_density", 0.0)
                reason += f" · Neighbor {neighbor} cap={int(n_cap*100)}%"
            self._initiate_switch(other_phase_idx, other_priority, reason)
            return self.last_decision_reason
        self.last_decision_reason = f"Maintaining {cur_phase_name}-Green (P={cur_priority} vs {other_phase_name} P={other_priority})."
        return self.last_decision_reason

    def _initiate_switch(self, new_phase_idx: int, priority: float, reason: str):
        self.allocated_green = int(self.MIN_GREEN + min(1.0, priority) * (self.MAX_GREEN - self.MIN_GREEN))
        self.target_phase = new_phase_idx
        self.is_yellow = True
        self.yellow_timer = self.YELLOW_TIME
        old_name = self.phase_names[self.current_phase]
        new_name = self.phase_names[new_phase_idx]
        self.last_decision_reason = f"Switching {old_name} → {new_name} ({reason}). Allocated: {self.allocated_green}s."

    def get_broadcast_message(self) -> Dict[str, Any]:
        densities = [d.get("density", 0.0) for d in self.local_obs.values()]
        queues = [d.get("queue_length", 0) for d in self.local_obs.values()]
        speeds = [d.get("average_speed", 16.67) for d in self.local_obs.values()]
        avg_density = round(sum(densities) / len(densities), 2) if densities else 0.0
        total_queue = sum(queues)
        avg_speed = round(sum(speeds) / len(speeds), 1) if speeds else 16.67
        avail_capacity = max(0.0, round(1.0 - avg_density, 2))
        active_incidents = [i for i in self.incidents.values() if i.get("active")]
        return {
            "sender": self.agent_id,
            "junction_id": self.junction_id,
            "timestamp": int(self.engine.get_current_time()),
            "current_phase": self.phase_names[self.current_phase] if not self.is_yellow else "YELLOW",
            "phase_idx": self.current_phase,
            "is_yellow": self.is_yellow,
            "yellow_remaining": self.yellow_timer if self.is_yellow else 0,
            "steps_on_phase": self.steps_on_phase,
            "allocated_green": self.allocated_green,
            "overall_density": avg_density,
            "total_queue": total_queue,
            "average_speed": avg_speed,
            "available_capacity": avail_capacity,
            "incident_active": len(active_incidents) > 0,
            "incidents": active_incidents,
            "emergency_active": self.emergency_override is not None,
            "local_obs": self.local_obs,
            "priorities": self.priorities,
            "decision_reason": self.last_decision_reason
        }

    def set_incident(self, road_id: str, incident_type: str, active: bool = True):
        self.incidents[road_id] = {"junction": self.junction_id,"road": road_id,"type": incident_type,"active": active,"timestamp": time.time()}

    def set_emergency(self, phase_name: Optional[str]):
        self.emergency_override = phase_name

    def reset(self):
        self.current_phase = 0
        self.is_yellow = False
        self.yellow_timer = 0
        self.target_phase = 0
        self.steps_on_phase = 0
        self.allocated_green = self.MIN_GREEN
