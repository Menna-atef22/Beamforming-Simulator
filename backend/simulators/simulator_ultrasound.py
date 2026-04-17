"""Ultrasound imaging simulator with B-mode and Doppler - OOP implementation"""

import math
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass

from ..core.beamforming_engine import BeamformingEngine, BeamformingResult
from ..core.array_model import ArrayModel
from ..core.signal_model import SignalModel
from ..core.noise_model import NoiseModel
from ..core.window_functions import WindowFunction


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
    """
    depths_mm: List[float]
    amplitudes: List[float]
    amplitudes_db: List[float]
    tissue_layers: List[TissueLayer]
    scatterers: List[Scatterer]
    metrics: Dict


@dataclass
class UltrasoundDopplerResult:
    """Doppler velocity imaging result.
    
    Attributes:
        frequencies_hz: Frequency shift axis in Hz.
        power: Doppler power spectrum (linear).
        power_db: Power in dB.
        mean_velocity_mms: Mean blood velocity in mm/s.
        max_velocity_mms: Maximum velocity.
        pulsatility_index: Resistance index for vascular assessment.
    """
    frequencies_hz: List[float]
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
        
        # Initialize default tissue model
        self._setup_default_tissue()
        self._setup_default_scatterers()
    
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
        enable_speckle: bool = True
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
        if enable_noise:
            self.noise.enable_noise()
        else:
            self.noise.disable_noise()
        
        # Convert steering angle to radians
        steer_rad = math.radians(steering_angle_deg)
        
        # Generate depth axis
        depths_mm = [max_depth_mm * i / (num_samples - 1) for i in range(num_samples)]
        amplitudes = []
        amplitudes_db = []
        
        # Compute B-mode image line
        for depth in depths_mm:
            # Base signal from tissue reflections
            signal = 0.0
            
            # Layer boundary reflections (with steering angle effect)
            # Steering angle changes the effective position where reflections are encountered
            reflection = self._compute_reflection(depth, steering_angle_deg)
            signal += reflection
            
            # Apply steering-dependent weighting (beam pattern effect)
            # Steering angle focuses beam at certain angles, reducing signal at grazing angles
            steer_efficiency = math.cos(steer_rad) ** 2
            signal *= steer_efficiency
            
            # Scatterer contributions (speckle)
            if enable_speckle:
                for scatterer in self.scatterers:
                    # Apply steering angle to scatterer position
                    lateral_pos = scatterer.lateral_mm
                    axial_pos = scatterer.depth_mm
                    
                    # Transform lateral position based on beam steering
                    effective_lateral = lateral_pos - depth * math.tan(steer_rad)
                    
                    distance = math.sqrt(effective_lateral ** 2 + (depth - axial_pos) ** 2)
                    
                    # Point spread function (PSF) of beam - depends on beam width
                    # Narrower beam for higher frequencies, wider for lower
                    beam_width = 2.0 * (self.signal.frequency / 5e6) ** -0.5
                    psf = math.exp(-(distance ** 2) / (2 * (beam_width ** 2)))
                    signal += scatterer.scattering_amplitude * psf
            
            # Apply attenuation with depth
            attenuation = self._compute_attenuation(depth)
            signal *= attenuation
            
            # Apply focusing gain
            focus_gain = self._compute_focus_gain(depth)
            signal *= (0.5 + 0.5 * focus_gain)
            
            # Apply SNR effect (controls signal vs noise ratio)
            snr_factor = 10 ** (self.noise.snr_db / 20.0)
            signal *= (snr_factor / (snr_factor + 1))
            
            # Limit signal to physical range
            signal = max(0, min(signal, 1.0))
            
            # Add noise if enabled
            if enable_noise:
                noise_power = self.noise.get_noise_power() / self.signal.amplitude
                signal = max(0, signal + noise_power * 0.1)
            
            amplitudes.append(signal)
            
            # Convert to dB for display
            signal_db = 20 * math.log10(max(signal, 1e-6))
            amplitudes_db.append(signal_db)
        
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
            "dynamic_range_db": self.dynamic_range_db
        }
        
        return UltrasoundBModeResult(
            depths_mm=depths_mm,
            amplitudes=amplitudes,
            amplitudes_db=amplitudes_db,
            tissue_layers=self.tissue_layers.copy(),
            scatterers=self.scatterers.copy(),
            metrics=metrics
        )
    
    def run_doppler(
        self,
        target_depth_mm: float = 50,
        num_freq_samples: int = 256,
        max_velocity_mms: float = 100,
        enable_noise: bool = True
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
        
        # Generate frequency axis (Doppler shift)
        nyquist_freq = 2 * self.signal.frequency * max_velocity_mms / (1000 * self.SPEED_OF_SOUND_TISSUE)
        frequencies_hz = [-nyquist_freq + 2 * nyquist_freq * i / (num_freq_samples - 1)
                          for i in range(num_freq_samples)]
        
        power = []
        
        # Compute Doppler spectrum
        for freq_hz in frequencies_hz:
            total_power = 0.0
            
            # Scatterer contributions
            for scatterer in self.scatterers:
                distance_from_target = abs(scatterer.depth_mm - target_depth_mm)
                
                # Only include scatterers near target depth
                if distance_from_target < 5.0:
                    # Doppler frequency from velocity
                    doppler_freq = 2 * self.signal.frequency * scatterer.motion_velocity_mms / (1000 * self.SPEED_OF_SOUND_TISSUE)
                    
                    # Gaussian frequency response
                    freq_response = math.exp(-((freq_hz - doppler_freq) ** 2) / (2 * (nyquist_freq / 20) ** 2))
                    
                    power_contribution = scatterer.scattering_amplitude * freq_response
                    total_power += power_contribution
            
            # Add noise
            if enable_noise:
                noise_power = self.noise.get_noise_power() / self.signal.amplitude
                total_power = max(0, total_power + noise_power * 0.01)
            
            power.append(total_power)
        
        # Convert to dB
        power_db = [20 * math.log10(max(p, 1e-10)) for p in power]
        
        # Compute Doppler metrics
        mean_velocity = sum(scatterer.motion_velocity_mms for scatterer in self.scatterers) / max(len(self.scatterers), 1)
        max_velocity = max((scatterer.motion_velocity_mms for scatterer in self.scatterers), default=0)
        
        # Pulsatility index (RI) = (max - min) / mean
        velocities = [s.motion_velocity_mms for s in self.scatterers]
        pi = ((max(velocities) - min(velocities)) / max(abs(mean_velocity), 0.01)) if velocities else 0
        
        return UltrasoundDopplerResult(
            frequencies_hz=frequencies_hz,
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
