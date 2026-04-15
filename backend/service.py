"""Service layer - business logic coordination"""

from typing import Dict, Any

try:
    from .core import BeamformingParams, run_simulation
    from .simulators import simulate_5g, simulate_radar, simulate_ultrasound
except ImportError:
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from core import BeamformingParams, run_simulation
    from simulators import simulate_5g, simulate_radar, simulate_ultrasound


class SimulationService:
    """Coordinates simulation requests with core engine"""

    @staticmethod
    def _params_to_core(params_dict: Dict[str, Any]) -> BeamformingParams:
        """Convert request parameters to core BeamformingParams"""
        return BeamformingParams(
            num_elements=params_dict.get("num_elements", 16),
            spacing=params_dict.get("spacing", 0.5),
            wavelength=params_dict.get("wavelength", 1.0),
            steering_angle_deg=params_dict.get("steering_angle_deg", 0),
            amplitude=params_dict.get("amplitude", 1.0),
            snr_db=params_dict.get("snr_db", 30),
            window_type=params_dict.get("window_type", "rectangular"),
            noise_enabled=params_dict.get("noise_enabled", False),
            apodization_enabled=params_dict.get("apodization_enabled", False)
        )

    @staticmethod
    def run_beamforming(params_dict: Dict[str, Any]):
        """Run beamforming simulation"""
        params = SimulationService._params_to_core(params_dict)
        return run_simulation(params)

    @staticmethod
    def run_5g(params_dict: Dict[str, Any]):
        """Run 5G simulation"""
        params = SimulationService._params_to_core(params_dict)
        return simulate_5g(params)

    @staticmethod
    def run_radar(params_dict: Dict[str, Any]):
        """Run Radar simulation"""
        params = SimulationService._params_to_core(params_dict)
        scan_speed = params_dict.get("scan_speed_deg", 5)
        beam_width = params_dict.get("beam_width_deg", 10)
        return simulate_radar(params, scan_speed, beam_width)

    @staticmethod
    def run_ultrasound(params_dict: Dict[str, Any]):
        """Run Ultrasound simulation"""
        params = SimulationService._params_to_core(params_dict)
        return simulate_ultrasound(params)
