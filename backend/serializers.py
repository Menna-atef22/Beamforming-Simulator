"""Serialization utilities for API responses"""

import math
from typing import Dict, Any


def serialize_array_element(elem) -> Dict[str, Any]:
    """Serialize ArrayElement to JSON-compatible dict"""
    return {
        "index": elem.index,
        "x": elem.x,
        "y": elem.y,
        "amplitude": elem.amplitude,
        "phase": elem.phase
    }


def serialize_beam_pattern(bp) -> Dict[str, Any]:
    """Serialize BeamPattern to JSON-compatible dict"""
    return {
        "angles": bp.angles,
        "magnitudes": bp.magnitudes,
        "magnitudes_db": bp.magnitudes_db
    }


def serialize_beam_metrics(metrics) -> Dict[str, Any]:
    """Serialize BeamMetrics to JSON-compatible dict"""
    return {
        "beamwidth_deg": metrics.beamwidth_deg,
        "sll_db": metrics.sll_db,
        "main_lobe_angle_deg": metrics.main_lobe_angle_deg
    }


def serialize_interference_map(imap) -> Dict[str, Any]:
    """Serialize InterferenceMapData to JSON-compatible dict"""
    return {
        "grid": imap.grid,
        "x_range": imap.x_range,
        "y_range": imap.y_range,
        "max_val": imap.max_val
    }


def serialize_beamforming_result(result) -> Dict[str, Any]:
    """Serialize BeamformingResult to API response format"""
    return {
        "array": [serialize_array_element(elem) for elem in result.array],
        "beam_pattern": serialize_beam_pattern(result.beam_pattern),
        "beam_pattern_no_steer": serialize_beam_pattern(result.beam_pattern_no_steer),
        "interference_map": serialize_interference_map(result.interference_map),
        "metrics": serialize_beam_metrics(result.metrics),
        "signal_profile": result.signal_profile
    }


def serialize_5g_result(result) -> Dict[str, Any]:
    """Serialize 5G simulation result"""
    beam_patterns = []
    for bp in result.beam_patterns:
        magnitudes = bp.get("magnitudes", [])
        beam_patterns.append({
            "tower_id": bp.get("tower_id"),
            "angles": bp.get("angles", []),
            "magnitudes": magnitudes,
            "magnitudes_db": [20 * math.log10(max(m, 1e-6)) for m in magnitudes]
        })
    
    return {
        "towers": [
            {
                "id": tower.id,
                "x": tower.x,
                "y": tower.y,
                "steering_angle_deg": tower.steering_angle_deg
            }
            for tower in result.towers
        ],
        "users": [
            {
                "id": user.id,
                "x": user.x,
                "y": user.y,
                "signal_strength": user.signal_strength
            }
            for user in result.users
        ],
        "beam_patterns": beam_patterns
    }


def serialize_radar_result(result) -> Dict[str, Any]:
    """Serialize Radar simulation result"""
    return {
        "angles": result.angles,
        "returns": result.returns,
        "targets": [
            {
                "id": i,
                "angle": target.angle_deg,
                "range": target.distance,
                "velocity": 0.0,  # Static targets in simulation
                "rcs": target.rcs
            }
            for i, target in enumerate(result.targets)
        ],
        "beam_width_deg": result.beam_width_deg
    }


def serialize_ultrasound_result(result) -> Dict[str, Any]:
    """Serialize Ultrasound simulation result"""
    return {
        "depths": result.depths,
        "amplitudes": result.amplitudes,
        "reflections": result.reflections
    }
