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
        "main_lobe_angle_deg": metrics.main_lobe_angle_deg,
        "directivity_db": getattr(metrics, "directivity_db", 0.0),
        "gain_peak": getattr(metrics, "gain_peak", 1.0)
    }


def serialize_interference_map(imap) -> Dict[str, Any]:
    """Serialize InterferenceMapData to JSON-compatible dict"""
    return {
        "grid": imap.grid,
        "x_range": imap.x_range,
        "y_range": imap.y_range,
        "max_val": imap.max_val,
        "max_val_per_amp": getattr(imap, "max_val_per_amp", None)
    }


def serialize_beamforming_result(result) -> Dict[str, Any]:
    """Serialize BeamformingResult to API response format"""
    return {
        "beam_pattern": serialize_beam_pattern(result.beam_pattern),
        "beam_pattern_no_steer": serialize_beam_pattern(result.beam_pattern_no_steer),
        "interference_map": serialize_interference_map(result.interference_map),
        "metrics": serialize_beam_metrics(result.metrics),
        "signal_profile": result.signal_profile
    }


def serialize_5g_result(result) -> Dict[str, Any]:
    """Serialize 5G simulation result"""
    beam_patterns = []
    if hasattr(result, 'beam_patterns') and result.beam_patterns:
        for bp in result.beam_patterns:
            if isinstance(bp, dict):
                magnitudes = bp.get("magnitudes", [])
            else:
                magnitudes = getattr(bp, 'magnitudes', [])
            beam_patterns.append({
                "tower_id": bp.get("tower_id") if isinstance(bp, dict) else getattr(bp, "tower_id", 0),
                "tower_x": bp.get("tower_x") if isinstance(bp, dict) else getattr(bp, "tower_x", 0.0),
                "tower_y": bp.get("tower_y") if isinstance(bp, dict) else getattr(bp, "tower_y", 0.0),
                "steering_angle_deg": bp.get("steering_angle_deg") if isinstance(bp, dict) else getattr(bp, "steering_angle_deg", 0.0),
                "num_elements": bp.get("num_elements") if isinstance(bp, dict) else getattr(bp, "num_elements", 0),
                "frequency": bp.get("frequency") if isinstance(bp, dict) else getattr(bp, "frequency", 0.0),
                "element_allocations": bp.get("element_allocations", []) if isinstance(bp, dict) else getattr(bp, "element_allocations", []),
                "angles": bp.get("angles", []) if isinstance(bp, dict) else getattr(bp, "angles", []),
                "magnitudes": magnitudes,
                "magnitudes_db": [20 * math.log10(max(m, 1e-3)) for m in magnitudes],
                "metrics": bp.get("metrics", {}) if isinstance(bp, dict) else getattr(bp, "metrics", {})
            })
    
    return {
        "towers": [
            {
                "id": tower.id,
                "x": tower.x,
                "y": tower.y,
                "steering_angle_deg": tower.steering_angle_deg,
                "beamwidth_deg": getattr(tower, "beamwidth_deg", 10.0),
                "max_gain_db": getattr(tower, "max_gain_db", 0.0),
                "coverage_radius_m": getattr(tower, "coverage_radius_m", 5.0),
                "num_elements": getattr(tower, "num_elements", None),
                "frequency": getattr(tower, "frequency", None),
            }
            for tower in result.towers
        ],

        "users": [
            {
                "id": user.id,
                "x": user.x,
                "y": user.y,
                "signal_strength": user.signal_strength,
                "snr_db": getattr(user, "snr_db", 30.0),
                "connected_tower_id": getattr(user, "connected_tower_id", None),
            }
            for user in result.users
        ],
        "connectivity_map": [
            {
                "tower_id": c.tower_id if hasattr(c, "tower_id") else c.get("tower_id"),
                "user_id": c.user_id if hasattr(c, "user_id") else c.get("user_id"),
                "distance_m": c.distance_m if hasattr(c, "distance_m") else c.get("distance_m"),
                "angle_to_user_deg": c.angle_to_user_deg if hasattr(c, "angle_to_user_deg") else c.get("angle_to_user_deg"),
                "angle_offset_from_beam_deg": c.angle_offset_from_beam_deg if hasattr(c, "angle_offset_from_beam_deg") else c.get("angle_offset_from_beam_deg"),
                "gain_at_user": c.gain_at_user if hasattr(c, "gain_at_user") else c.get("gain_at_user"),
                "path_loss_db": c.path_loss_db if hasattr(c, "path_loss_db") else c.get("path_loss_db"),
                "signal_strength": c.signal_strength if hasattr(c, "signal_strength") else c.get("signal_strength")
            }
            for c in (result.connectivity_map if hasattr(result, "connectivity_map") else [])
        ],
        "network_coverage": result.network_coverage if hasattr(result, "network_coverage") else {},
        "beam_patterns": beam_patterns
    }


def serialize_radar_result(result) -> Dict[str, Any]:
    """Serialize Radar simulation result"""
    targets = []
    if hasattr(result, 'targets'):
        for i, target in enumerate(result.targets):
            targets.append({
                "id": getattr(target, "id", i),
                "angle_deg": getattr(target, "angle_deg", 0.0),
                "distance_m": getattr(target, "distance_m", 0.0),
                "rcs_dbsm": getattr(target, "rcs_dbsm", 0.0),
                "velocity_mps": getattr(target, "velocity_mps", 0.0)
            })
    
    detections = []
    if hasattr(result, 'detections'):
        for detection in result.detections:
            detections.append({
                "angle_deg": getattr(detection, "angle_deg", 0.0),
                "distance_m": getattr(detection, "distance_m", 0.0),
                "snr_db": getattr(detection, "snr_db", 0.0),
                "power": getattr(detection, "power", 0.0),
                "confidence": getattr(detection, "confidence", 0.0)
            })
    
    range_doppler_map = {}
    if hasattr(result, 'range_doppler_map'):
        range_doppler_map = {
            "ranges_m": getattr(result.range_doppler_map, "ranges_m", []),
            "doppler_shifts_hz": getattr(result.range_doppler_map, "doppler_shifts_hz", []),
            "velocities_mps": getattr(result.range_doppler_map, "velocities_mps", [])
        }
    
    metrics = {}
    if hasattr(result, 'metrics'):
        metrics = {
            "num_targets": getattr(result.metrics, "num_targets", 0),
            "num_detections": getattr(result.metrics, "num_detections", 0),
            "detection_rate": getattr(result.metrics, "detection_rate", 0.0),
            "false_alarms": getattr(result.metrics, "false_alarms", 0),
            "avg_snr_db": getattr(result.metrics, "avg_snr_db", 0.0),
            "avg_confidence": getattr(result.metrics, "avg_confidence", 0.0)
        }
    
    return {
        "angles": getattr(result, "angles_deg", []),
        "magnitudes": getattr(result, "magnitudes", []),
        "magnitudes_db": getattr(result, "magnitudes_db", []),
        "targets": targets,
        "detections": detections,
        "range_doppler_map": range_doppler_map,
        "metrics": metrics,
        "beam_width_deg": getattr(result, "beam_width_deg", 10.0),
        "noise_buffer": getattr(result, "noise_buffer", [])
    }


def serialize_ultrasound_result(result) -> Dict[str, Any]:
    """Serialize Ultrasound simulation result"""
    bmode = {}
    if hasattr(result, 'bmode'):
        bmode_metrics = getattr(result.bmode, "metrics", {})
        if not isinstance(bmode_metrics, dict):
            bmode_metrics = {}

        phantom_ellipses = getattr(result.bmode, "phantom_ellipses", [])
        phantom_payload = None
        if isinstance(phantom_ellipses, list) and phantom_ellipses:
            phantom_payload = {
                "model": getattr(result.bmode, "phantom_model", "modified_shepp_logan"),
                "domain": getattr(result.bmode, "phantom_domain", [-1.0, 1.0]),
                "ellipses": phantom_ellipses,
            }

        bmode = {
            "depths_mm": getattr(result.bmode, "depths_mm", []),
            "amplitudes": getattr(result.bmode, "amplitudes", []),
            "amplitudes_db": getattr(result.bmode, "amplitudes_db", []),
            "reflections": getattr(result.bmode, "reflections", []),
            "metrics": {
                "contrast_db": float(bmode_metrics.get("contrast_db", 0.0)),
                "speckle_snr_db": float(bmode_metrics.get("speckle_snr_db", 0.0)),
                "penetration_depth_mm": float(bmode_metrics.get("penetration_depth_mm", 0.0)),
                "focal_depth_mm": float(bmode_metrics.get("focal_depth_mm", 0.0)),
                "dynamic_range_db": float(bmode_metrics.get("dynamic_range_db", 0.0)),
                "reflection_count": float(bmode_metrics.get("reflection_count", 0.0)),
            },
            "phantom": phantom_payload,
        }
    
    doppler = {}
    if hasattr(result, 'doppler') and result.doppler:
        doppler = {
            "frequencies_hz": getattr(result.doppler, "frequencies_hz", []),
            "power": getattr(result.doppler, "power", []),
            "power_db": getattr(result.doppler, "power_db", []),
            "mean_velocity_mms": getattr(result.doppler, "mean_velocity_mms", 0.0),
            "max_velocity_mms": getattr(result.doppler, "max_velocity_mms", 0.0),
            "pulsatility_index": getattr(result.doppler, "pulsatility_index", 0.0)
        }
    
    return {
        "bmode": bmode,
        "doppler": doppler if doppler else None
    }