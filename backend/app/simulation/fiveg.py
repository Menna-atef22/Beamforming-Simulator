from __future__ import annotations

import math

from ..schemas import (
    FiveGRequest,
    FiveGResponse,
    LinkResult,
    TowerAutoParameters,
)


def _angle_deg(x0: float, y0: float, x1: float, y1: float) -> float:
    return math.degrees(math.atan2(y1 - y0, x1 - x0))


def _mean_angle(angles_deg: list[float]) -> float:
    if not angles_deg:
        return 0.0
    sin_sum = sum(math.sin(math.radians(a)) for a in angles_deg)
    cos_sum = sum(math.cos(math.radians(a)) for a in angles_deg)
    return math.degrees(math.atan2(sin_sum, cos_sum))


def _angular_spread(angles_deg: list[float]) -> float:
    if len(angles_deg) < 2:
        return 10.0
    wrapped = sorted((a + 360.0) % 360.0 for a in angles_deg)
    gaps = [wrapped[i + 1] - wrapped[i] for i in range(len(wrapped) - 1)]
    gaps.append(360.0 - wrapped[-1] + wrapped[0])
    largest_gap = max(gaps)
    return max(360.0 - largest_gap, 8.0)


def simulate_fiveg(req: FiveGRequest) -> FiveGResponse:
    links: list[LinkResult] = []

    per_tower_connected: dict[str, list[str]] = {tower.id: [] for tower in req.towers}
    per_tower_angles: dict[str, list[float]] = {tower.id: [] for tower in req.towers}
    per_tower_distances: dict[str, list[float]] = {tower.id: [] for tower in req.towers}

    for tower in req.towers:
        for user in req.users:
            distance = math.hypot(user.x - tower.x, user.y - tower.y)
            distance_km = max(distance / 1000.0, 1e-4)
            freq_mhz = tower.carrier_ghz * 1000.0

            fspl_db = 32.44 + 20.0 * math.log10(freq_mhz) + 20.0 * math.log10(distance_km)
            array_gain_db = 10.0 * math.log10(max(tower.num_elements, 1))
            rx_power_dbm = tower.power_dbm - fspl_db + array_gain_db

            snr_linear_gain_db = 10.0 * math.log10(req.snr + 1.0)
            snr_db = rx_power_dbm - req.noise_floor_dbm + snr_linear_gain_db

            in_range = distance <= tower.max_range_m
            connected = in_range and snr_db >= 0.0
            quality = max(0.0, min(1.0, 1.0 / (1.0 + math.exp(-(snr_db - 8.0) / 6.0))))

            if connected:
                per_tower_connected[tower.id].append(user.id)
                per_tower_angles[tower.id].append(_angle_deg(tower.x, tower.y, user.x, user.y))
                per_tower_distances[tower.id].append(distance)

            links.append(
                LinkResult(
                    tower_id=tower.id,
                    user_id=user.id,
                    distance_m=distance,
                    snr_db=snr_db,
                    quality=quality,
                    connected=connected,
                )
            )

    auto_towers: list[TowerAutoParameters] = []
    for tower in req.towers:
        connected_user_ids = per_tower_connected[tower.id]
        angles = per_tower_angles[tower.id]
        distances = per_tower_distances[tower.id]

        if connected_user_ids:
            steering_angle_deg = _mean_angle(angles)
            spread = _angular_spread(angles)
            beam_width_deg = max(6.0, min(95.0, spread + 8.0))
            farthest = max(distances)
            utilization = farthest / max(tower.max_range_m, 1e-6)
            suggested_power_dbm = max(15.0, min(68.0, tower.power_dbm + (utilization - 0.6) * 8.0))
            suggested_num_elements = int(max(8, min(256, round(tower.num_elements * (1.0 + utilization * 0.4)))))
        else:
            steering_angle_deg = 0.0
            beam_width_deg = 70.0
            suggested_power_dbm = max(15.0, tower.power_dbm - 3.0)
            suggested_num_elements = max(8, int(tower.num_elements * 0.8))

        auto_towers.append(
            TowerAutoParameters(
                id=tower.id,
                steering_angle_deg=steering_angle_deg,
                beam_width_deg=beam_width_deg,
                suggested_power_dbm=suggested_power_dbm,
                suggested_num_elements=suggested_num_elements,
                connected_user_ids=connected_user_ids,
            )
        )

    return FiveGResponse(links=links, towers=auto_towers)
