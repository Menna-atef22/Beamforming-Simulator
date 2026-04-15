from __future__ import annotations

import math

import numpy as np

from ..schemas import RadarDetection, RadarRequest, RadarResponse


def _angle_diff_deg(a: float, b: float) -> float:
    d = (a - b + 180.0) % 360.0 - 180.0
    return abs(d)


def simulate_radar(req: RadarRequest) -> RadarResponse:
    next_angle = (req.current_angle_deg + req.scan_speed_deg_s * req.delta_time_s) % 360.0

    half_bw = req.beam_width_deg / 2.0
    base_angle = math.radians(next_angle)

    # Wedge polygon points for frontend visualization.
    sweep_points: list[list[float]] = [[0.0, 0.0]]
    for deg in np.linspace(-half_bw, half_bw, 14):
        a = base_angle + math.radians(float(deg))
        sweep_points.append([
            req.max_range_m * math.cos(a),
            req.max_range_m * math.sin(a),
        ])

    detections: list[RadarDetection] = []
    for body in req.bodies:
        range_m = math.hypot(body.x, body.y)
        if range_m > req.max_range_m:
            continue

        bearing_deg = (math.degrees(math.atan2(body.y, body.x)) + 360.0) % 360.0
        if _angle_diff_deg(bearing_deg, next_angle) > half_bw:
            continue

        spread_penalty = max(0.2, 1.0 - (req.beam_width_deg / 140.0))
        strength = (body.reflectivity * (req.snr + 1.0) * spread_penalty) / (range_m**2 + 30.0)
        if strength < 0.01:
            continue

        estimation_noise = (req.beam_width_deg / 90.0) * (1.0 / math.sqrt(req.snr + 1.0))
        estimated_size = max(0.2, body.size_m + np.random.normal(0.0, estimation_noise * body.size_m))

        detections.append(
            RadarDetection(
                body_id=body.id,
                range_m=range_m,
                bearing_deg=bearing_deg,
                estimated_size_m=float(estimated_size),
                strength=float(min(strength, 1.0)),
            )
        )

    detections.sort(key=lambda d: d.range_m)

    return RadarResponse(
        next_angle_deg=next_angle,
        detections=detections,
        sweep_points=sweep_points,
        max_range_m=req.max_range_m,
    )
