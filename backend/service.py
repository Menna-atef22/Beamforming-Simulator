"""Service layer - business logic coordination for simulation requests"""

from typing import Dict, Any, Optional
import logging
import math

from .core import BeamformingEngine, ArrayModel, SignalModel, NoiseModel, WindowFunction
from .simulators import Simulator5G, SimulatorRadar, SimulatorUltrasound
from .serializers import serialize_beamforming_result, serialize_5g_result, serialize_radar_result, serialize_ultrasound_result

logger = logging.getLogger(__name__)


class SimulationService:
    """Coordinates simulation requests with appropriate simulator engines.
    
    This service layer translates API requests into simulator operations,
    handling parameter extraction, simulator instantiation, and result formatting.
    """

    @staticmethod
    def run_beamforming(params_dict: Dict[str, Any]) -> Dict[str, Any]:
        """Run generic beamforming simulation with beam pattern computation.
        
        Args:
            params_dict: Request parameters dictionary with:
                - num_elements: Number of array elements (default: 16)
                - spacing: Element spacing in wavelengths (default: 0.5)
                - frequency: Operating frequency in Hz (default: 10e9)
                - steering_angle_deg: Beam steering angle (default: 0)
                - amplitude: Signal amplitude (default: 1.0)
                - snr_db: SNR in dB (default: 30)
                - window_type: Apodization window (default: "hamming")
                - enable_noise: Add noise (default: False)
                - grid_size: Angle grid resolution (default: 360)
        
        Returns:
            Dictionary with "success" and either "data" or "error" key.
        """
        try:
            num_elements = params_dict.get("num_elements", 16)
            spacing = params_dict.get("spacing", 0.5)
            geometry = params_dict.get("geometry", "linear")
            radius = params_dict.get("radius", 5.0)
            frequency = params_dict.get("frequency", 10e9)
            steering_angle_deg = params_dict.get("steering_angle_deg", 0)
            amplitude = params_dict.get("amplitude", 1.0)
            snr_db = params_dict.get("snr_db", 30)
            window_type = params_dict.get("window_type", "hamming")
            enable_noise = params_dict.get("enable_noise", False)
            grid_size = params_dict.get("grid_size", 360)
            
            # Create array model and run simulation
            array = ArrayModel(num_elements, spacing, frequency, amplitude, geometry=geometry, radius=radius)
            signal = SignalModel(frequency, 3e8, amplitude)
            noise = NoiseModel(snr_db)
            window = WindowFunction(window_type, num_elements)
            
            engine = BeamformingEngine(array, signal, noise, window)
            result = engine.run_simulation(
                steering_angle_deg=steering_angle_deg,
                enable_noise=enable_noise,
                grid_size=grid_size
            )
            
            return {
                "success": True,
                "data": serialize_beamforming_result(result)
            }
        except Exception as e:
            logger.error(f"Beamforming simulation failed: {str(e)}", exc_info=True)
            return {"success": False, "error": str(e)}

    @staticmethod
    def run_5g(params_dict: Dict[str, Any]) -> Dict[str, Any]:
        """Run 5G network simulation with tower-user connectivity.
        
        Args:
            params_dict: Request parameters with:
                - num_elements: Array elements (default: 16)
                - spacing: Element spacing (default: 0.5)
                - frequency: Operating frequency in Hz (default: 28e9)
                - snr_db: SNR in dB (default: 30)
                - auto_steer: Auto-steer to nearest user (default: True)
                - enable_noise: Add noise (default: False)
                - grid_size: Angle grid resolution (default: 80)
                - users: Optional list of {id, x, y} to override default positions
                - towers: Optional list of {id, x, y} to override default positions
        
        Returns:
            Dictionary with "success" and either "data" or "error" key.
        """
        try:
            num_elements = params_dict.get("num_elements", 16)
            spacing = params_dict.get("spacing", 0.5)
            frequency = params_dict.get("frequency", 28e9)
            snr_db = params_dict.get("snr_db", 30)
            auto_steer = params_dict.get("auto_steer", True)
            enable_noise = params_dict.get("enable_noise", False)
            grid_size = params_dict.get("grid_size", 80)
            custom_users = params_dict.get("users")
            custom_towers = params_dict.get("towers")
            # current_connections: {str(user_id): tower_id} from frontend (JSON keys are strings)
            raw_connections = params_dict.get("current_connections")
            current_connections = (
                {int(k): v for k, v in raw_connections.items()}
                if isinstance(raw_connections, dict) else None
            )
            
            simulator = Simulator5G(
                num_elements=num_elements,
                spacing=spacing,
                frequency=frequency,
                snr_db=snr_db
            )
            
            # Apply custom user positions if provided (override defaults)
            if custom_users is not None:
                simulator.users.clear()
                for u in custom_users:
                    uid = u["id"] if isinstance(u, dict) else u.id
                    ux = u["x"] if isinstance(u, dict) else u.x
                    uy = u["y"] if isinstance(u, dict) else u.y
                    simulator.add_user(user_id=uid, x=ux, y=uy)
            
            # Apply custom tower positions + per-tower param overrides
            if custom_towers is not None:
                simulator.towers.clear()
                for t in custom_towers:
                    is_dict = isinstance(t, dict)
                    tid   = t["id"]               if is_dict else t.id
                    tx    = t["x"]                if is_dict else t.x
                    ty    = t["y"]                if is_dict else t.y
                    t_n   = t.get("num_elements")      if is_dict else getattr(t, "num_elements", None)
                    t_f   = t.get("frequency")         if is_dict else getattr(t, "frequency", None)
                    t_r   = t.get("coverage_radius_m") if is_dict else getattr(t, "coverage_radius_m", None)
                    simulator.add_tower(tower_id=tid, x=tx, y=ty)
                    # Apply per-tower overrides onto the just-added Tower object
                    added = simulator.towers[-1]
                    if t_n is not None:      added.num_elements      = int(t_n)
                    if t_f is not None:      added.frequency         = float(t_f)
                    if t_r is not None:      added.coverage_radius_m = float(t_r)

            
            result = simulator.run(
                auto_steer=auto_steer,
                enable_noise=enable_noise,
                grid_size=grid_size,
                current_connections=current_connections,
            )
            
            return {
                "success": True,
                "data": serialize_5g_result(result)
            }
        except Exception as e:
            logger.error(f"5G simulation failed: {str(e)}", exc_info=True)
            return {"success": False, "error": str(e)}

    @staticmethod
    def run_radar(params_dict: Dict[str, Any]) -> Dict[str, Any]:
        """Run radar simulation with target detection and Doppler processing.
        
        Args:
            params_dict: Request parameters with:
                - num_elements: Antenna elements (default: 32)
                - spacing: Element spacing (default: 0.5)
                - frequency: Operating frequency in Hz (default: 10e9)
                - snr_db: SNR in dB (default: 15)
                - steering_angle_deg: Beam steering angle (default: 0)
                - scan_range_deg: Angular scan range (default: 360)
                - enable_noise: Add noise (default: True)
                - grid_size: Angle grid resolution (default: 360)
                - compute_doppler: Compute Doppler map (default: True)
        
        Returns:
            Dictionary with "success" and either "data" or "error" key.
        """
        try:
            num_elements = params_dict.get("num_elements", 32)
            spacing = params_dict.get("spacing", 0.5)
            frequency = params_dict.get("frequency", 10e9)
            snr_db = params_dict.get("snr_db", 15)
            steering_angle_deg = params_dict.get("steering_angle_deg", 0)
            scan_range_deg = params_dict.get("scan_range_deg", 360)
            enable_noise = params_dict.get("enable_noise", True)
            grid_size = params_dict.get("grid_size", 360)
            compute_doppler = params_dict.get("compute_doppler", True)
            
            simulator = SimulatorRadar(
                num_elements=num_elements,
                spacing=spacing,
                frequency=frequency,
                snr_db=snr_db
            )
            
            result = simulator.run(
                steering_angle_deg=steering_angle_deg,
                scan_range_deg=scan_range_deg,
                enable_noise=enable_noise,
                grid_size=grid_size,
                compute_doppler=compute_doppler
            )
            
            return {
                "success": True,
                "data": serialize_radar_result(result)
            }
        except Exception as e:
            logger.error(f"Radar simulation failed: {str(e)}", exc_info=True)
            return {"success": False, "error": str(e)}

    @staticmethod
    def run_ultrasound(params_dict: Dict[str, Any]) -> Dict[str, Any]:
        """Run Ultrasound B-mode and optional Doppler imaging simulation.
        
        Args:
            params_dict: Request parameters with:
                - num_elements: Array elements (default: 64)
                - spacing: Element spacing (default: 0.3)
                - frequency: Ultrasound frequency in Hz (default: 5e6)
                - snr_db: SNR in dB (default: 25)
                - max_depth_mm: Maximum imaging depth (default: 100)
                - num_samples: Depth sample points (default: 512)
                - enable_noise: Add noise (default: True)
                - enable_speckle: Add speckle pattern (default: True)
                - run_doppler: Also run Doppler imaging (default: False)
                - target_depth_mm: Doppler imaging depth (default: 50)
        
        Returns:
            Dictionary with "success" and either "data" or "error" key.
        """
        try:
            num_elements = params_dict.get("num_elements", 64)
            spacing = params_dict.get("spacing", 0.3)
            frequency = params_dict.get("frequency", 5e6)
            snr_db = params_dict.get("snr_db", 25)
            window_type = params_dict.get("window_type", "rectangular")
            max_depth_mm = params_dict.get("max_depth_mm", 100)
            num_samples = params_dict.get("num_samples", 512)
            enable_noise = params_dict.get("enable_noise", True)
            enable_speckle = params_dict.get("enable_speckle", True)
            run_doppler = params_dict.get("run_doppler", False)
            target_depth_mm = params_dict.get("target_depth_mm", 50)
            probe_param_rad = params_dict.get("probe_param_rad")
            phantom_regions = params_dict.get("phantom_regions")
            
            simulator = SimulatorUltrasound(
                num_elements=num_elements,
                spacing=spacing,
                frequency=frequency,
                snr_db=snr_db,
                window_type=window_type,
            )

            if isinstance(phantom_regions, list) and phantom_regions:
                simulator.set_phantom_regions(phantom_regions)
            
            # Run B-mode imaging
            bmode_result = simulator.run_bmode(
                steering_angle_deg=params_dict.get("steering_angle_deg", 0),
                max_depth_mm=max_depth_mm,
                num_samples=num_samples,
                enable_noise=enable_noise,
                enable_speckle=enable_speckle,
                probe_param_rad=probe_param_rad
            )
            
            # Build result object with necessary attributes
            class UltrasoundResultWrapper:
                def __init__(self, bmode, doppler=None):
                    self.bmode = bmode
                    self.doppler = doppler
            
            result = UltrasoundResultWrapper(bmode_result, None)
            if run_doppler:
                result.doppler = simulator.run_doppler(target_depth_mm=target_depth_mm)
            
            return {
                "success": True,
                "data": serialize_ultrasound_result(result)
            }
        except Exception as e:
            logger.error(f"Ultrasound simulation failed: {str(e)}", exc_info=True)
            return {"success": False, "error": str(e)}
