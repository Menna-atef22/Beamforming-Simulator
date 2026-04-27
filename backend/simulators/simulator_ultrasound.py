"""Ultrasound imaging simulator with B-mode and Doppler - OOP implementation"""

import math
import random
import zlib
import logging
from typing import List, Dict, Tuple, Optional, Any
from dataclasses import dataclass

from ..core.beamforming_engine import BeamformingEngine, BeamformingResult
from ..core.array_model import ArrayModel
from ..core.signal_model import SignalModel
from ..core.noise_model import NoiseModel
from ..core.window_functions import WindowFunction


logger = logging.getLogger(__name__)


@dataclass
class TissueLayer:
    """Acoustic tissue layer with properties.
    
    Attributes:
        depth_mm: Depth from surface in millimeters.
        thickness_mm: Layer thickness in millimeters.
        acoustic_impedance: Acoustic impedance (kg/m²·s).
        attenuation_db_mm: Attenuation coefficient in dB/mm.
        reflection_coefficient: Acoustic reflection coefficient (0-1).
        speed_of_sound_mps: Sound propagation speed in m/s.
    """
    depth_mm: float
    thickness_mm: float
    acoustic_impedance: float
    attenuation_db_mm: float
    reflection_coefficient: float
    speed_of_sound_mps: float = 1540.0  # Average tissue speed


@dataclass
class Scatterer:
    """Point scatterer in tissue (for speckle pattern).
    
    Attributes:
        depth_mm: Depth in millimeters.
        lateral_mm: Lateral position relative to beam in millimeters.
        scattering_amplitude: Scattering strength (0-1).
        motion_velocity_mms: Motion velocity in mm/s for Doppler.
    """
    depth_mm: float
    lateral_mm: float
    scattering_amplitude: float
    motion_velocity_mms: float = 0.0


@dataclass
class UltrasoundBModeResult:
    """B-mode (brightness mode) ultrasound result.
    
    Attributes:
        depths_mm: Axial depth axis in mm.
        amplitudes: Normalized intensity (0-1).
        amplitudes_db: Intensity in dB (20*log10(amplitude)).
        tissue_layers: Simulated tissue structure.
        scatterers: Point scatterers generating speckle.
        metrics: Image quality metrics (contrast, resolution).
        reflections: Significant boundary echoes used in A-mode display.
        phantom_model: Phantom model identifier.
        phantom_domain: Coordinate domain used by phantom definition.
        phantom_ellipses: Canonical phantom ellipse list.
    """
    depths_mm: List[float]
    amplitudes: List[float]
    amplitudes_db: List[float]
    tissue_layers: List[TissueLayer]
    scatterers: List[Scatterer]
    metrics: Dict
    reflections: List[Dict[str, float]]
    phantom_model: str
    phantom_domain: List[float]
    phantom_ellipses: List[Dict[str, Any]]


@dataclass
class UltrasoundDopplerResult:
    """Doppler velocity imaging result.
    
    Attributes:
        frequencies_hz: Frequency shift axis in Hz.
        velocities_mms: Velocity axis in mm/s mapped from Doppler frequency.
        power: Doppler power spectrum (linear).
        power_db: Power in dB.
        mean_velocity_mms: Mean blood velocity in mm/s.
        max_velocity_mms: Maximum velocity.
        pulsatility_index: Resistance index for vascular assessment.
    """
    frequencies_hz: List[float]
    velocities_mms: List[float]
    power: List[float]
    power_db: List[float]
    mean_velocity_mms: float
    max_velocity_mms: float
    pulsatility_index: float


class SimulatorUltrasound(BeamformingEngine):
    """Ultrasound imaging simulator with B-mode and Doppler processing.
    
    This class extends BeamformingEngine to simulate ultrasound imaging including
    tissue layers, attenuation, focusing effects, and Doppler velocity estimation.
    
    Attributes:
        tissue_layers: List of tissue acoustic layers.
        scatterers: List of point scatterers for speckle.
        dynamic_range_db: Display dynamic range in dB (default: 40).
        focal_depth_mm: Acoustic focal depth in millimeters.
    """
    
    # Ultrasound system parameters
    SPEED_OF_SOUND_TISSUE = 1540.0  # m/s
    ACOUSTIC_IMPEDANCE_WATER = 1.48e6  # kg/m²·s
    
    def __init__(
        self,
        num_elements: int = 64,
        spacing: float = 0.3,
        frequency: float = 5e6,
        snr_db: float = 25,
        window_type: str = "hamming",
        amplitude: float = 1.0,
        dynamic_range_db: float = 40.0,
        focal_depth_mm: float = 50.0
    ):
        """Initialize ultrasound simulator with phased array parameters.
        
        Args:
            num_elements: Number of array elements (default: 64).
            spacing: Element spacing in wavelengths (default: 0.3).
            frequency: Ultrasound frequency in Hz (default: 5 MHz).
            snr_db: Signal-to-noise ratio in dB (default: 25).
            window_type: Apodization window (default: "hamming").
            amplitude: Reference amplitude (default: 1.0).
            dynamic_range_db: Display dynamic range in dB (default: 40).
            focal_depth_mm: Acoustic focus depth in mm (default: 50).
        
        Raises:
            ValueError: If parameters invalid.
        """
        # Initialize parent BeamformingEngine
        array = ArrayModel(num_elements, spacing, frequency, amplitude, self.SPEED_OF_SOUND_TISSUE)
        signal = SignalModel(frequency, self.SPEED_OF_SOUND_TISSUE, amplitude)
        noise = NoiseModel(snr_db)
        window = WindowFunction(window_type, num_elements)
        
        super().__init__(array, signal, noise, window)
        
        # Ultrasound-specific parameters
        self.tissue_layers: List[TissueLayer] = []
        self.scatterers: List[Scatterer] = []
        self.dynamic_range_db: float = dynamic_range_db
        self.focal_depth_mm: float = focal_depth_mm
        self.phantom_model: str = "modified_shepp_logan"
        self.phantom_domain: List[float] = [-1.0, 1.0]
        self.phantom_ellipses: List[Dict[str, Any]] = self._get_modified_shepp_logan_ellipses()
        
        # Initialize default tissue model
        self._setup_default_tissue()
        self._setup_default_scatterers()

    @staticmethod
    def _get_modified_shepp_logan_ellipses() -> List[Dict[str, Any]]:
        """Return exact Modified Shepp-Logan (Toft/MATLAB default) ellipse table.

        Each ellipse uses the canonical parameter tuple [A, a, b, x0, y0, phi]:
        - A: additive intensity
        - a, b: semiaxis lengths in normalized domain [-1, 1]
        - x0, y0: center offsets
        - phi: counterclockwise rotation angle in degrees
        """
        return [
            {
                "region_id": 1,
                "label": "Background Soft Tissue",
                "intensity": 1.0,
                "a": 0.6900,
                "b": 0.9200,
                "x0": 0.0000,
                "y0": 0.0000,
                "phi_deg": 0.0,
                "acoustic_impedance_mrayl": 1.54,
                "attenuation_db_cm_mhz": 0.42,
                "backscatter_coeff": 0.14,
                "speed_of_sound_mps": 1540.0,
                "scatter_density": 0.30,
                "boundary_roughness": 0.22,
            },
            {
                "region_id": 2,
                "label": "CSF/Ventricle-like Region",
                "intensity": -0.8,
                "a": 0.6624,
                "b": 0.8740,
                "x0": 0.0000,
                "y0": -0.0184,
                "phi_deg": 0.0,
                "acoustic_impedance_mrayl": 1.51,
                "attenuation_db_cm_mhz": 0.02,
                "backscatter_coeff": 0.06,
                "speed_of_sound_mps": 1505.0,
                "scatter_density": 0.10,
                "boundary_roughness": 0.10,
            },
            {
                "region_id": 3,
                "label": "Dense Lesion A",
                "intensity": -0.2,
                "a": 0.1100,
                "b": 0.3100,
                "x0": 0.2200,
                "y0": 0.0000,
                "phi_deg": -18.0,
                "acoustic_impedance_mrayl": 1.72,
                "attenuation_db_cm_mhz": 0.85,
                "backscatter_coeff": 0.44,
                "speed_of_sound_mps": 1570.0,
                "scatter_density": 0.62,
                "boundary_roughness": 0.48,
            },
            {
                "region_id": 4,
                "label": "Dense Lesion B",
                "intensity": -0.2,
                "a": 0.1600,
                "b": 0.4100,
                "x0": -0.2200,
                "y0": 0.0000,
                "phi_deg": 18.0,
                "acoustic_impedance_mrayl": 1.68,
                "attenuation_db_cm_mhz": 0.78,
                "backscatter_coeff": 0.40,
                "speed_of_sound_mps": 1560.0,
                "scatter_density": 0.58,
                "boundary_roughness": 0.46,
            },
            {
                "region_id": 5,
                "label": "Parenchyma-like Region",
                "intensity": 0.1,
                "a": 0.2100,
                "b": 0.2500,
                "x0": 0.0000,
                "y0": 0.3500,
                "phi_deg": 0.0,
                "acoustic_impedance_mrayl": 1.65,
                "attenuation_db_cm_mhz": 0.60,
                "backscatter_coeff": 0.32,
                "speed_of_sound_mps": 1545.0,
                "scatter_density": 0.50,
                "boundary_roughness": 0.40,
            },
            {
                "region_id": 6,
                "label": "Calcification 1",
                "intensity": 0.1,
                "a": 0.0460,
                "b": 0.0460,
                "x0": 0.0000,
                "y0": 0.1000,
                "phi_deg": 0.0,
                "acoustic_impedance_mrayl": 5.50,
                "attenuation_db_cm_mhz": 6.00,
                "backscatter_coeff": 0.85,
                "speed_of_sound_mps": 3200.0,
                "scatter_density": 0.25,
                "boundary_roughness": 0.82,
            },
            {
                "region_id": 7,
                "label": "Calcification 2",
                "intensity": 0.1,
                "a": 0.0460,
                "b": 0.0460,
                "x0": 0.0000,
                "y0": -0.1000,
                "phi_deg": 0.0,
                "acoustic_impedance_mrayl": 5.20,
                "attenuation_db_cm_mhz": 5.40,
                "backscatter_coeff": 0.80,
                "speed_of_sound_mps": 3000.0,
                "scatter_density": 0.22,
                "boundary_roughness": 0.78,
            },
            {
                "region_id": 8,
                "label": "Cystic Node 1",
                "intensity": 0.1,
                "a": 0.0460,
                "b": 0.0230,
                "x0": -0.0800,
                "y0": -0.6050,
                "phi_deg": 0.0,
                "acoustic_impedance_mrayl": 1.49,
                "attenuation_db_cm_mhz": 0.04,
                "backscatter_coeff": 0.04,
                "speed_of_sound_mps": 1490.0,
                "scatter_density": 0.08,
                "boundary_roughness": 0.08,
            },
            {
                "region_id": 9,
                "label": "Cystic Node 2",
                "intensity": 0.1,
                "a": 0.0230,
                "b": 0.0230,
                "x0": 0.0000,
                "y0": -0.6050,
                "phi_deg": 0.0,
                "acoustic_impedance_mrayl": 1.50,
                "attenuation_db_cm_mhz": 0.05,
                "backscatter_coeff": 0.05,
                "speed_of_sound_mps": 1495.0,
                "scatter_density": 0.09,
                "boundary_roughness": 0.09,
            },
            {
                "region_id": 10,
                "label": "Cystic Node 3",
                "intensity": 0.1,
                "a": 0.0230,
                "b": 0.0460,
                "x0": 0.0600,
                "y0": -0.6050,
                "phi_deg": 0.0,
                "acoustic_impedance_mrayl": 1.52,
                "attenuation_db_cm_mhz": 0.05,
                "backscatter_coeff": 0.05,
                "speed_of_sound_mps": 1500.0,
                "scatter_density": 0.09,
                "boundary_roughness": 0.09,
            },
        ]

    def set_phantom_regions(self, regions: List[Dict[str, Any]]) -> None:
        """Override phantom regions with user-provided editable acoustic parameters."""
        if not isinstance(regions, list) or not regions:
            return

        defaults = self._get_modified_shepp_logan_ellipses()
        normalized_regions: List[Dict[str, Any]] = []

        for idx, region in enumerate(regions):
            if not isinstance(region, dict):
                continue

            default_region = defaults[min(idx, len(defaults) - 1)]
            merged = {**default_region, **region}

            merged["region_id"] = int(merged.get("region_id", idx + 1))
            merged["label"] = str(merged.get("label", f"Region {idx + 1}"))
            merged["intensity"] = float(merged.get("intensity", default_region["intensity"]))
            merged["a"] = max(0.01, float(merged.get("a", default_region["a"])))
            merged["b"] = max(0.01, float(merged.get("b", default_region["b"])))
            merged["x0"] = float(merged.get("x0", default_region["x0"]))
            merged["y0"] = float(merged.get("y0", default_region["y0"]))
            merged["phi_deg"] = float(merged.get("phi_deg", default_region["phi_deg"]))

            merged["acoustic_impedance_mrayl"] = max(
                1.0,
                min(8.0, float(merged.get("acoustic_impedance_mrayl", default_region["acoustic_impedance_mrayl"])))
            )
            merged["attenuation_db_cm_mhz"] = max(
                0.0,
                min(12.0, float(merged.get("attenuation_db_cm_mhz", default_region["attenuation_db_cm_mhz"])))
            )
            merged["backscatter_coeff"] = max(
                0.0,
                min(1.0, float(merged.get("backscatter_coeff", default_region["backscatter_coeff"])))
            )
            merged["speed_of_sound_mps"] = max(
                1200.0,
                min(4000.0, float(merged.get("speed_of_sound_mps", default_region["speed_of_sound_mps"])))
            )
            merged["scatter_density"] = max(
                0.0,
                min(1.0, float(merged.get("scatter_density", default_region["scatter_density"])))
            )
            merged["boundary_roughness"] = max(
                0.0,
                min(1.0, float(merged.get("boundary_roughness", default_region["boundary_roughness"])))
            )

            normalized_regions.append(merged)

        if normalized_regions:
            self.phantom_ellipses = normalized_regions

    @staticmethod
    def _point_in_region(x_norm: float, y_norm: float, region: Dict[str, Any]) -> bool:
        """Check whether a normalized point belongs to a phantom ellipse."""
        phi = math.radians(float(region.get("phi_deg", 0.0)))
        cos_phi = math.cos(phi)
        sin_phi = math.sin(phi)

        dx = x_norm - float(region.get("x0", 0.0))
        dy = y_norm - float(region.get("y0", 0.0))
        x_rot = dx * cos_phi + dy * sin_phi
        y_rot = -dx * sin_phi + dy * cos_phi

        a = max(1e-6, float(region.get("a", 0.1)))
        b = max(1e-6, float(region.get("b", 0.1)))
        norm = (x_rot * x_rot) / (a * a) + (y_rot * y_rot) / (b * b)
        return norm <= 1.0

    def _find_phantom_region(self, x_norm: float, y_norm: float) -> Optional[Dict[str, Any]]:
        """Find top-most phantom region at a normalized coordinate."""
        for region in reversed(self.phantom_ellipses):
            if self._point_in_region(x_norm, y_norm, region):
                return region
        return None

    def _get_outer_boundary_region(self) -> Optional[Dict[str, Any]]:
        """Return the largest-area phantom region as outer boundary."""
        if not self.phantom_ellipses:
            return None

        return max(
            self.phantom_ellipses,
            key=lambda region: float(region.get("a", 0.0)) * float(region.get("b", 0.0)),
        )

    def _compute_probe_pose(
        self,
        probe_param_rad: float,
        steering_angle_deg: float,
    ) -> Tuple[float, float, float, float]:
        """Compute probe origin and inward beam direction in normalized domain."""
        outer = self._get_outer_boundary_region()
        if outer is None:
            steer_rad = math.radians(steering_angle_deg)
            return 0.0, 1.0, math.sin(steer_rad), -math.cos(steer_rad)

        a = max(1e-6, float(outer.get("a", 0.7)))
        b = max(1e-6, float(outer.get("b", 0.9)))
        x0 = float(outer.get("x0", 0.0))
        y0 = float(outer.get("y0", 0.0))
        phi_rad = math.radians(float(outer.get("phi_deg", 0.0)))
        cos_phi = math.cos(phi_rad)
        sin_phi = math.sin(phi_rad)

        local_x = a * math.cos(probe_param_rad)
        local_y = b * math.sin(probe_param_rad)
        probe_x_norm = x0 + local_x * cos_phi - local_y * sin_phi
        probe_y_norm = y0 + local_x * sin_phi + local_y * cos_phi

        normal_local_x = math.cos(probe_param_rad) / a
        normal_local_y = math.sin(probe_param_rad) / b
        normal_global_x = normal_local_x * cos_phi - normal_local_y * sin_phi
        normal_global_y = normal_local_x * sin_phi + normal_local_y * cos_phi
        normal_mag = max(1e-9, math.hypot(normal_global_x, normal_global_y))

        inward_x = -normal_global_x / normal_mag
        inward_y = -normal_global_y / normal_mag

        steer_rad = math.radians(steering_angle_deg)
        dir_x = inward_x * math.cos(steer_rad) - inward_y * math.sin(steer_rad)
        dir_y = inward_x * math.sin(steer_rad) + inward_y * math.cos(steer_rad)

        return probe_x_norm, probe_y_norm, dir_x, dir_y
    
    def _setup_default_tissue(self) -> None:
        """Set up default tissue layer model."""
        # Skin/subcutaneous layer
        self.tissue_layers.append(TissueLayer(
            depth_mm=0, thickness_mm=3, acoustic_impedance=1.6e6,
            attenuation_db_mm=0.5, reflection_coefficient=0.05
        ))
        
        # Muscle layer
        self.tissue_layers.append(TissueLayer(
            depth_mm=3, thickness_mm=10, acoustic_impedance=1.7e6,
            attenuation_db_mm=0.8, reflection_coefficient=0.02
        ))
        
        # Fat layer
        self.tissue_layers.append(TissueLayer(
            depth_mm=13, thickness_mm=8, acoustic_impedance=1.38e6,
            attenuation_db_mm=0.6, reflection_coefficient=0.08
        ))
        
        # Organ tissue
        self.tissue_layers.append(TissueLayer(
            depth_mm=21, thickness_mm=15, acoustic_impedance=1.65e6,
            attenuation_db_mm=1.0, reflection_coefficient=0.15
        ))
    
    def _setup_default_scatterers(self) -> None:
        """Set up random point scatterers for speckle pattern."""
        import random
        random.seed(42)
        
        for _ in range(20):
            depth = random.uniform(5, 40)
            lateral = random.uniform(-2, 2)
            amplitude = random.uniform(0.3, 0.9)
            self.scatterers.append(Scatterer(
                depth_mm=depth,
                lateral_mm=lateral,
                scattering_amplitude=amplitude,
                motion_velocity_mms=random.uniform(-5, 5)
            ))
    
    def add_tissue_layer(
        self,
        depth_mm: float,
        thickness_mm: float,
        acoustic_impedance: float,
        attenuation_db_mm: float,
        reflection_coefficient: float
    ) -> TissueLayer:
        """Add acoustic tissue layer to model.
        
        Args:
            depth_mm: Depth from surface in mm.
            thickness_mm: Layer thickness in mm.
            acoustic_impedance: Acoustic impedance in kg/m²·s.
            attenuation_db_mm: Attenuation in dB/mm.
            reflection_coefficient: Reflection coefficient (0-1).
        
        Returns:
            The created TissueLayer instance.
        """
        layer = TissueLayer(
            depth_mm=depth_mm,
            thickness_mm=thickness_mm,
            acoustic_impedance=acoustic_impedance,
            attenuation_db_mm=attenuation_db_mm,
            reflection_coefficient=reflection_coefficient
        )
        self.tissue_layers.append(layer)
        return layer
    
    def add_scatterer(
        self,
        depth_mm: float,
        lateral_mm: float,
        scattering_amplitude: float,
        motion_velocity_mms: float = 0.0
    ) -> Scatterer:
        """Add point scatterer to tissue.
        
        Args:
            depth_mm: Depth in mm.
            lateral_mm: Lateral offset in mm.
            scattering_amplitude: Scattering strength (0-1).
            motion_velocity_mms: Motion velocity in mm/s (default: 0).
        
        Returns:
            The created Scatterer instance.
        """
        scatterer = Scatterer(
            depth_mm=depth_mm,
            lateral_mm=lateral_mm,
            scattering_amplitude=scattering_amplitude,
            motion_velocity_mms=motion_velocity_mms
        )
        self.scatterers.append(scatterer)
        return scatterer
    
    def _compute_focus_gain(self, depth_mm: float) -> float:
        """Compute beam focusing gain as function of depth.
        
        Focusing sharpens beam at focal depth, broadens elsewhere.
        
        Args:
            depth_mm: Depth in millimeters.
        
        Returns:
            Focusing gain (0-1, peak at focal depth).
        """
        # Gaussian focusing profile
        focal_gain = math.exp(-((depth_mm - self.focal_depth_mm) ** 2) / (2 * (self.focal_depth_mm / 4) ** 2))
        return focal_gain
    
    def _compute_attenuation(self, depth_mm: float) -> float:
        """Compute frequency-dependent attenuation through tissue.
        
        Uses summation over tissue layers with frequency dependence.
        Higher frequencies attenuate more strongly (proportional to f^2).
        
        Args:
            depth_mm: Depth in millimeters.
        
        Returns:
            Attenuation factor (0-1, where 1 is no loss).
        """
        total_attenuation_db = 0
        cumulative_depth = 0
        
        # Frequency-dependent attenuation coefficient (roughly f^2)
        # Reference: 5 MHz attenuation from tissue layers
        # Higher frequency = more attenuation
        freq_attenuation_factor = (self.signal.frequency / 5e6) ** 2
        
        for layer in self.tissue_layers:
            layer_end = layer.depth_mm + layer.thickness_mm
            
            if cumulative_depth < depth_mm:
                # How much of this layer contributes
                contribution = min(depth_mm, layer_end) - max(cumulative_depth, layer.depth_mm)
                # Apply frequency-dependent scaling
                total_attenuation_db += layer.attenuation_db_mm * contribution * freq_attenuation_factor
            
            cumulative_depth = layer_end
        
        # Convert dB attenuation to linear factor
        attenuation_factor = 10 ** (-total_attenuation_db / 20)
        return attenuation_factor
    
    def _compute_reflection(self, depth_mm: float, steering_angle_deg: float = 0) -> float:
        """Compute acoustic reflection at tissue boundary, with steering angle effect.
        
        Steering angle affects which tissue boundaries are sampled.
        
        Args:
            depth_mm: Depth at reflection boundary.
            steering_angle_deg: Beam steering angle in degrees.
        
        Returns:
            Reflection coefficient (0-1).
        """
        # Convert steering angle to radians
        steer_rad = math.radians(steering_angle_deg)
        
        # Steering angle affects the effective depth at which tissue interfaces are encountered
        # This simulates the beam hitting tissue at different angles/locations
        steering_offset = depth_mm * math.tan(steer_rad) * 0.2  # Scale factor for effect magnitude
        
        # Find tissue layer at this depth, accounting for steering
        effective_depth = max(0, depth_mm + steering_offset)
        
        for layer in self.tissue_layers:
            if layer.depth_mm <= effective_depth < layer.depth_mm + layer.thickness_mm:
                # Steering angle affects reflection strength (glancing angle effect)
                angle_factor = math.cos(steer_rad) ** 2  # Reflection decreases at grazing angles
                return layer.reflection_coefficient * angle_factor
        
        return 0.0
    
    def run_bmode(
        self,
        steering_angle_deg: float = 0,
        max_depth_mm: float = 100,
        num_samples: int = 512,
        enable_noise: bool = True,
        enable_speckle: bool = True,
        probe_param_rad: Optional[float] = None,
    ) -> UltrasoundBModeResult:
        """Execute B-mode (brightness) ultrasound imaging.
        
        Args:
            steering_angle_deg: Beam steering angle (default: 0).
            max_depth_mm: Maximum imaging depth (default: 100 mm).
            num_samples: Axial sample points (default: 512).
            enable_noise: Add thermal noise (default: True).
            enable_speckle: Add speckle pattern (default: True).
        
        Returns:
            UltrasoundBModeResult with image and tissue structure.
        """
        # Update noise settings
        if not enable_noise:
            self.noise.set_snr(float("inf"))
        
        # Convert steering angle to radians
        steer_rad = math.radians(steering_angle_deg)
        frequency_mhz = self.signal.frequency / 1e6

        if probe_param_rad is None:
            probe_param_rad = math.pi / 2

        probe_x_norm, probe_y_norm, ray_dir_x, ray_dir_y = self._compute_probe_pose(
            probe_param_rad=probe_param_rad,
            steering_angle_deg=steering_angle_deg,
        )
        ray_length_norm = 2.5
        element_positions = self.array.get_element_positions()
        window_weights = self.window.get_weights()
        if len(window_weights) != len(element_positions):
            window_weights = [1.0] * len(element_positions)
        total_window_weight = max(sum(window_weights), 1e-9)
        
        # Generate depth axis
        depths_mm = [max_depth_mm * i / (num_samples - 1) for i in range(num_samples)]
        amplitudes = []
        amplitudes_db = []
        reflections: List[Dict[str, float]] = []

        prev_region: Optional[Dict[str, Any]] = None
        cumulative_atten_db = 0.0
        prev_depth_mm = 0.0

        # Coupling gel / water-like entry medium to avoid an overly bright skin boundary.
        base_medium_impedance_mrayl = 1.48
        impedance_values = [base_medium_impedance_mrayl]
        impedance_values.extend(
            float(region.get("acoustic_impedance_mrayl", base_medium_impedance_mrayl))
            for region in self.phantom_ellipses
        )
        impedance_range = max(max(impedance_values) - min(impedance_values), 1e-6)
        snr_linear = 10 ** (self.noise.snr_db / 20.0)
        noise_sigma = 0.00005 / max(snr_linear, 1e-6)
        noise_seed_source = (
            f"{probe_param_rad:.12f}|{steering_angle_deg:.6f}|{self.noise.snr_db:.6f}|"
            f"{self.signal.frequency:.3f}|{self.window.window_type}|{max_depth_mm:.6f}|{num_samples}"
        )
        noise_rng = random.Random(zlib.crc32(noise_seed_source.encode("ascii")))
        depth_step_mm = max_depth_mm / max(num_samples - 1, 1)
        min_transition_spacing_mm = max(depth_step_mm, 0.2)
        last_transition_depth_mm = -1e9
        near_field_span_mm = max(8.0, min(20.0, 0.12 * max_depth_mm))
        
        # Compute B-mode image line
        for depth in depths_mm:
            depth_ratio = max(0.0, min(1.0, depth / max(max_depth_mm, 1e-6)))
            x_norm = probe_x_norm + ray_dir_x * depth_ratio * ray_length_norm
            y_norm = probe_y_norm + ray_dir_y * depth_ratio * ray_length_norm
            region = self._find_phantom_region(x_norm, y_norm)

            current_impedance = (
                float(region.get("acoustic_impedance_mrayl", base_medium_impedance_mrayl))
                if region
                else base_medium_impedance_mrayl
            )
            current_attenuation = (
                float(region.get("attenuation_db_cm_mhz", 0.5))
                if region
                else 0.5
            )

            step_cm = max(0.0, (depth - prev_depth_mm) / 10.0)
            cumulative_atten_db += current_attenuation * frequency_mhz * step_cm * 2.0

            # Boundary-only reflection model:
            # emit spikes only when ray crosses a region boundary.
            signal = 0.0
            prev_region_id = int(prev_region.get("region_id", -1)) if prev_region else -1
            current_region_id = int(region.get("region_id", -1)) if region else -1

            if current_region_id != prev_region_id and (depth - last_transition_depth_mm) >= min_transition_spacing_mm:
                prev_impedance = (
                    float(prev_region.get("acoustic_impedance_mrayl", base_medium_impedance_mrayl))
                    if prev_region
                    else base_medium_impedance_mrayl
                )
                impedance_diff = abs(current_impedance - prev_impedance)
                reflection_coeff = impedance_diff / max(current_impedance + prev_impedance, 1e-9)

                boundary_echo = reflection_coeff
                signal = boundary_echo
                reflections.append({"depth_mm": depth, "amplitude": boundary_echo})
                last_transition_depth_mm = depth

            # Keep tissue interiors mostly dark with subtle gray texture.
            interior_echo = 0.0
            signal += interior_echo
            
            # Apply steering-dependent weighting (beam pattern effect)
            # Steering angle focuses beam at certain angles, reducing signal at grazing angles
            steer_efficiency = math.cos(steer_rad) ** 2
            signal *= steer_efficiency
            
            # Apply attenuation with depth
            attenuation_layer = self._compute_attenuation(depth)
            attenuation_region = 10 ** (-cumulative_atten_db / 20.0)
            signal *= attenuation_layer * attenuation_region

            # Suppress very shallow amplitudes so early echoes do not dominate B-mode dynamic range.
            near_field_ramp = min(1.0, max(0.0, depth / near_field_span_mm))
            signal *= near_field_ramp ** 1.35

            # Mild depth gain compensation to avoid excessive near-field dominance.
            tgc_db = min(depth * frequency_mhz * 0.12, self.dynamic_range_db * 0.35)
            signal *= 10 ** (tgc_db / 20.0)
            
            # Apply focusing gain
            focus_gain = self._compute_focus_gain(depth)
            signal *= (0.5 + 0.5 * focus_gain)

            # Compute A-mode ray from a coherent sum of element contributions,
            # weighted by the selected apodization window.
            depth_m = max(depth * 1e-3, 1e-6)
            focus_x = depth_m * math.sin(steer_rad)
            focus_y = depth_m * math.cos(steer_rad)
            real_sum = 0.0
            imag_sum = 0.0

            for n, (elem_x, _) in enumerate(element_positions):
                r_n = math.sqrt((focus_x - elem_x) ** 2 + focus_y ** 2)
                if r_n < 1e-9:
                    continue

                # Steering delay phase for element n: -k*x_n*sin(theta_steer)
                phase_shift_n = -self.array.wave_number * elem_x * math.sin(steer_rad)
                phase = self.array.wave_number * r_n + phase_shift_n
                real_sum += window_weights[n] * math.cos(phase)
                imag_sum += window_weights[n] * math.sin(phase)

            coherent_gain = math.sqrt(real_sum ** 2 + imag_sum ** 2) / total_window_weight
            beamforming_gain = 0.35 + 0.65 * coherent_gain
            signal *= beamforming_gain
            
            # Keep non-boundary samples strictly zero; only boundary echoes may carry noise.
            if enable_noise and signal > 0.0:
                signal += noise_rng.gauss(0.0, noise_sigma)
            
            # Limit signal to physical range
            signal = max(0, min(signal, 1.0))
            
            amplitudes.append(signal)
            
            # Convert to dB for display
            signal_db = 20 * math.log10(max(signal, 1e-6))
            amplitudes_db.append(signal_db)

            prev_depth_mm = depth
            prev_region = region

        reflection_details = [
            {
                "depth_mm": round(float(reflection.get("depth_mm", 0.0)), 4),
                "amplitude": round(float(reflection.get("amplitude", 0.0)), 6),
            }
            for reflection in reflections
        ]
        logger.info(
            "[run_bmode] reflections_detected=%d details=%s",
            len(reflections),
            reflection_details,
        )
        
        # Normalize B-mode display
        max_db = max(amplitudes_db)
        amplitudes_db = [max(d, max_db - self.dynamic_range_db) for d in amplitudes_db]
        
        # Image quality metrics
        contrast = max(amplitudes_db) - min(amplitudes_db) if amplitudes_db else 0
        
        # Speckle signal-to-noise ratio
        signal_power = sum(a ** 2 for a in amplitudes) / max(len(amplitudes), 1)
        speckle_snr = 20 * math.log10(math.sqrt(signal_power) + 1e-10)
        
        metrics = {
            "contrast_db": contrast,
            "speckle_snr_db": speckle_snr,
            "penetration_depth_mm": max_depth_mm,
            "focal_depth_mm": self.focal_depth_mm,
            "dynamic_range_db": self.dynamic_range_db,
            "reflection_count": len(reflections)
        }
        
        return UltrasoundBModeResult(
            depths_mm=depths_mm,
            amplitudes=amplitudes,
            amplitudes_db=amplitudes_db,
            tissue_layers=self.tissue_layers.copy(),
            scatterers=self.scatterers.copy(),
            metrics=metrics,
            reflections=reflections,
            phantom_model=self.phantom_model,
            phantom_domain=self.phantom_domain.copy(),
            phantom_ellipses=[ellipse.copy() for ellipse in self.phantom_ellipses]
        )
    
    def run_doppler(
        self,
        target_depth_mm: float = 50,
        num_freq_samples: int = 256,
        max_velocity_mms: float = 100,
        enable_noise: bool = True,
        beam_angle_deg: float = 0.0
    ) -> UltrasoundDopplerResult:
        """Execute Doppler velocity imaging.
        
        Args:
            target_depth_mm: Imaging depth for Doppler (default: 50 mm).
            num_freq_samples: Frequency samples (default: 256).
            max_velocity_mms: Maximum detectable velocity (default: 100 mm/s).
            enable_noise: Add thermal noise (default: True).
        
        Returns:
            UltrasoundDopplerResult with velocity spectrum.
        """
        if enable_noise:
            self.noise.enable_noise()
        else:
            self.noise.disable_noise()

        beam_angle_rad = math.radians(beam_angle_deg)
        cos_theta = math.cos(beam_angle_rad)
        v_max_ms = max_velocity_mms / 1000.0
        nyquist_freq = (2 * self.signal.frequency * v_max_ms) / self.SPEED_OF_SOUND_TISSUE
        freq_step = (2 * nyquist_freq) / max(num_freq_samples - 1, 1)
        frequencies_hz = [-nyquist_freq + freq_step * i for i in range(num_freq_samples)]

        # ---- collect contributing scatterers ONCE (outside freq loop) ----
        contributing = []
        for scatterer in self.scatterers:
            if abs(scatterer.depth_mm - target_depth_mm) < 5.0:
                v_ms = scatterer.motion_velocity_mms / 1000.0
                doppler_freq = (2 * self.signal.frequency * v_ms * cos_theta) / self.SPEED_OF_SOUND_TISSUE
                if abs(doppler_freq) > nyquist_freq:
                    logger.warning(
                        "Doppler aliasing detected: f_d=%.1f Hz exceeds Nyquist=%.1f Hz",
                        doppler_freq, nyquist_freq,
                    )
                contributing.append({
                    "velocity_mms": scatterer.motion_velocity_mms,
                    "doppler_freq": doppler_freq,
                    "amplitude": scatterer.scattering_amplitude,
                })

        # ---- metrics computed from contributing scatterers only ----
        if contributing:
            total_weight = sum(s["amplitude"] for s in contributing)
            mean_velocity = (
                sum(s["velocity_mms"] * s["amplitude"] for s in contributing) / total_weight
                if total_weight > 0 else 0.0
            )
            velocities = [s["velocity_mms"] for s in contributing]
            max_velocity = max(abs(v) for v in velocities)
            min_velocity = min(velocities)
            max_velocity_signed = max(velocities)
            pi = (max_velocity_signed - min_velocity) / max(abs(mean_velocity), 0.01)
        else:
            mean_velocity = 0.0
            max_velocity = 0.0
            min_velocity = 0.0
            pi = 0.0

        # ---- build power spectrum (freq loop only does the Gaussian sum) ----
        width = max(nyquist_freq / 20.0, 1e-9)
        power = []
        for freq_hz in frequencies_hz:
            total_power = sum(
                s["amplitude"] * math.exp(-((freq_hz - s["doppler_freq"]) ** 2) / (2 * width ** 2))
                for s in contributing
            )
            if enable_noise:
                noise_power = self.noise.get_noise_power() / self.signal.amplitude
                total_power = max(0.0, total_power + noise_power * 0.01)
            power.append(total_power)

        power_db = [20 * math.log10(max(p, 1e-10)) for p in power]

        if abs(cos_theta) > 1e-9:
            velocities_mms = [
                (f * self.SPEED_OF_SOUND_TISSUE) / (2 * self.signal.frequency * cos_theta) * 1000.0
                for f in frequencies_hz
            ]
        else:
            velocities_mms = [0.0] * num_freq_samples
        
        return UltrasoundDopplerResult(
            frequencies_hz=frequencies_hz,
            velocities_mms=velocities_mms,
            power=power,
            power_db=power_db,
            mean_velocity_mms=mean_velocity,
            max_velocity_mms=max_velocity,
            pulsatility_index=pi
        )
    
    def get_depth_profile(self, lateral_mm: float = 0, num_samples: int = 256) -> Dict:
        """Generate depth profile at lateral position.
        
        Args:
            lateral_mm: Lateral offset from beam axis in mm (default: 0).
            num_samples: Number of depth samples (default: 256).
        
        Returns:
            Dictionary with depth axis and intensity profile.
        """
        max_depth = 100
        depths = [max_depth * i / (num_samples - 1) for i in range(num_samples)]
        profile = []
        
        for depth in depths:
            signal = self._compute_reflection(depth)
            signal *= self._compute_attenuation(depth)
            signal *= self._compute_focus_gain(depth)
            
            profile.append(signal)
        
        return {
            "depths_mm": depths,
            "lateral_mm": lateral_mm,
            "profile": profile
        }
