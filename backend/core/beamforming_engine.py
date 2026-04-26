"""Main beamforming computation engine - OOP implementation"""

import math
from typing import List, Optional, Tuple
from dataclasses import dataclass, field

from .interference_map import InterferenceMap, InterferenceMapResult


@dataclass
class BeamPattern:
    """Computed beam pattern across angular range.
    
    Attributes:
        angles: List of angles in degrees.
        magnitudes: Normalized beam magnitudes (linear 0-1).
        magnitudes_db: Beam magnitudes in dB (20*log10(mag)).
    """
    angles: List[float]
    magnitudes: List[float]
    magnitudes_db: List[float]


@dataclass
class BeamMetrics:
    """Metrics derived from beam pattern analysis.
    
    Attributes:
        beamwidth_deg: 3-dB beamwidth in degrees.
        sll_db: Peak sidelobe level relative to main lobe in dB.
        main_lobe_angle_deg: Direction of main lobe peak in degrees.
        directivity_db: Directivity index in dB.
        gain_peak: Peak normalized gain (linear).
    """
    beamwidth_deg: float
    sll_db: float
    main_lobe_angle_deg: float
    directivity_db: float = 0.0
    gain_peak: float = 1.0


@dataclass
class BeamformingResult:
    """Complete result from beamforming simulation.
    
    Attributes:
        beam_pattern: Steered beam pattern.
        beam_pattern_no_steer: Broadside beam pattern (0° steering).
        interference_map: 2D spatial field pattern.
        metrics: Computed beam metrics.
        signal_profile: 1D line cut through beam pattern.
    """
    beam_pattern: BeamPattern
    beam_pattern_no_steer: BeamPattern
    interference_map: 'InterferenceMapResult'
    metrics: BeamMetrics
    signal_profile: List[dict] = field(default_factory=list)


class BeamformingEngine:
    """Orchestrates complete beamforming simulation pipeline.
    
    This class brings together array geometry, signal propagation, noise,
    and windowing to produce a complete beamforming simulation. It uses
    dependency injection for all DSP components, enabling flexible composition
    and testing.
    
    Attributes:
        array: ArrayModel instance (antenna geometry).
        signal: SignalModel instance (propagation parameters).
        noise: NoiseModel instance (noise injection).
        window: WindowFunction instance (apodization).
        interference_map_engine: InterferenceMap for 2D field computation.
    """
    
    # Default angular step for beam pattern computation (degrees)
    DEFAULT_ANGLE_STEP = 1.0
    
    # Angular range for beam pattern (degrees)
    DEFAULT_ANGLE_RANGE = 180.0
    
    # Default grid size for interference map
    DEFAULT_GRID_SIZE = 60
    
    # Default spatial extent for interference map
    DEFAULT_EXTENT = 5.0
    
    # Position for signal profile extraction (meters)
    DEFAULT_PROFILE_DEPTH = 2.0
    
    def __init__(self, array, signal, noise, window):
        """Initialize BeamformingEngine with DSP components.
        
        Args:
            array: ArrayModel instance defining array geometry.
            signal: SignalModel instance defining propagation physics.
            noise: NoiseModel instance for SNR-based noise.
            window: WindowFunction instance for apodization.
        
        Raises:
            TypeError: If any component is None.
        """
        if array is None or signal is None or noise is None or window is None:
            raise TypeError("All components (array, signal, noise, window) must be non-None")
        
        self.array = array
        self.signal = signal
        self.noise = noise
        self.window = window
        
        # Create interference map engine for 2D field computation
        self.interference_map_engine = InterferenceMap(array, signal, noise, window)
    
    def compute_beam_pattern(
        self,
        steering_angle_deg: float,
        angle_step: float = None,
        steering_angles_deg: List[float] = None
    ) -> BeamPattern:
        """Compute beam pattern (magnitude vs angle) at given steering angle.
        
        Sweeps across angular range and computes array factor at each angle,
        accounting for steering, windowing (apodization), and noise.
        
        Args:
            steering_angle_deg: Main beam steering angle in degrees.
            angle_step: Angular resolution in degrees (default: 0.5).
        
        Returns:
            BeamPattern with angles, linear magnitudes, and dB magnitudes.
        
        Raises:
            ValueError: If angle_step <= 0 or steering_angle_deg out of [-90, 90].
        """
        if angle_step is None:
            angle_step = self.DEFAULT_ANGLE_STEP
        
        if angle_step <= 0:
            raise ValueError("angle_step must be > 0")
        
        if steering_angle_deg < -90 or steering_angle_deg > 90:
            raise ValueError("steering_angle_deg must be in [-90, 90]")
        
        angles = []
        magnitudes = []

        # Compute array factor across a linear angular range from -90 to +90
        start_angle = -90.0
        end_angle = 90.0
        num_angles = int((end_angle - start_angle) / angle_step) + 1

        for i in range(num_angles):
            angle_deg = start_angle + i * angle_step

            # Compute array factor at this angle with steering
            if steering_angles_deg is not None:
                af_mag = self.array.compute_multi_steered_af(
                    angles_deg=[angle_deg],
                    steering_angles_deg=steering_angles_deg,
                    weights=self.window.get_weights()
                )[0]
            else:
                af_mag = self.array.compute_af(
                    angles_deg=[angle_deg],
                    steering_angle_deg=steering_angle_deg,
                    weights=self.window.get_weights()
                )[0]

            angles.append(angle_deg)
            magnitudes.append(af_mag)
        
        # Find peak magnitude for normalization
        max_mag = max(magnitudes) if magnitudes else 1.0
        if max_mag <= 0:
            max_mag = 1.0
        
        # Convert to dB: 20*log10(mag/max_mag) - normalized to peak = 0 dB
        # Floor at 1e-3 => -60 dB (physically meaningful dynamic range)
        DB_FLOOR = 1e-3
        magnitudes_db = []
        for mag in magnitudes:
            mag_db = 20 * math.log10(max(mag / max_mag, DB_FLOOR))
            magnitudes_db.append(mag_db)
        
        return BeamPattern(
            angles=angles,
            magnitudes=magnitudes,
            magnitudes_db=magnitudes_db
        )
    
    def apply_apodization(self) -> List[float]:
        """Get apodization weights from window function.
        
        Returns:
            List of weights (0 to 1) for each array element.
        """
        return self.window.get_weights()
    
    def _compute_metrics(self, beam_pattern: BeamPattern) -> BeamMetrics:
        """Compute beam metrics from beam pattern.
        
        Computes beamwidth, sidelobe level, directivity, and peak gain.
        
        Args:
            beam_pattern: BeamPattern instance to analyze.
        
        Returns:
            BeamMetrics with all computed values.
        """
        if not beam_pattern.magnitudes:
            return BeamMetrics(0, 0, 0, 0, 0)
        
        # Find main lobe peak
        max_mag = max(beam_pattern.magnitudes)
        if max_mag <= 0:
            return BeamMetrics(0, 0, 0, 0, 0)
        
        max_idx = beam_pattern.magnitudes.index(max_mag)
        main_lobe_angle_deg = beam_pattern.angles[max_idx]
        
        # Compute 3dB beamwidth
        half_power = max_mag / math.sqrt(2)
        
        # Find left edge of main lobe
        left_idx = max_idx
        while left_idx > 0 and beam_pattern.magnitudes[left_idx] > half_power:
            left_idx -= 1
        
        # Find right edge of main lobe
        right_idx = max_idx
        while right_idx < len(beam_pattern.magnitudes) - 1 and beam_pattern.magnitudes[right_idx] > half_power:
            right_idx += 1
        
        beamwidth_deg = abs(beam_pattern.angles[right_idx] - beam_pattern.angles[left_idx])
        
        # Compute peak sidelobe level using local peaks outside main-lobe region.
        # Exclude main-lobe neighborhood within HPBW/2 and immediate peak neighbors.
        sidelobe_peak = 0.0
        half_hpbw_deg = beamwidth_deg / 2.0
        excluded_indices = {max_idx}
        if max_idx - 1 >= 0:
            excluded_indices.add(max_idx - 1)
        if max_idx + 1 < len(beam_pattern.magnitudes):
            excluded_indices.add(max_idx + 1)

        for i, angle in enumerate(beam_pattern.angles):
            if abs(angle - main_lobe_angle_deg) <= half_hpbw_deg:
                excluded_indices.add(i)

        local_sidelobe_peaks = []
        n_points = len(beam_pattern.magnitudes)
        for i in range(n_points):
            if i in excluded_indices:
                continue

            mag_i = beam_pattern.magnitudes[i]
            left_mag = beam_pattern.magnitudes[i - 1] if i > 0 else float("-inf")
            right_mag = beam_pattern.magnitudes[i + 1] if i < n_points - 1 else float("-inf")

            if mag_i >= left_mag and mag_i >= right_mag:
                local_sidelobe_peaks.append(mag_i)

        if local_sidelobe_peaks:
            sidelobe_peak = max(local_sidelobe_peaks)

        # SLL in dB relative to main lobe
        if sidelobe_peak > 1e-10 and max_mag > 1e-10:
            sll_db = 20 * math.log10(sidelobe_peak / max_mag)
        else:
            sll_db = -60.0
        
        # Compute directivity index
        avg_mag = sum(beam_pattern.magnitudes) / len(beam_pattern.magnitudes)
        if avg_mag > 1e-10:
            directivity_db = 10 * math.log10(max_mag / avg_mag)
        else:
            directivity_db = 0.0
        
        return BeamMetrics(
            beamwidth_deg=beamwidth_deg,
            sll_db=sll_db,
            main_lobe_angle_deg=main_lobe_angle_deg,
            directivity_db=directivity_db,
            gain_peak=max_mag
        )
    
    def _compute_signal_profile(
        self,
        steering_angle_deg: float,
        depth: float = None,
        num_samples: int = 80,
        extent: float = None,
        steering_angles_deg: List[float] = None
    ) -> List[dict]:
        """Compute 1D signal profile (line cut) through beam pattern.
        
        Extracts field values along a horizontal line at specified depth,
        useful for visualization and analysis.
        
        Args:
            steering_angle_deg: Beam steering angle in degrees.
            depth: Distance from array for profile extraction (default: 2.0 m).
            num_samples: Number of sample points (default: 80).
        
        Returns:
            List of dicts with 'position' (meters) and 'amplitude' keys.
        
        Raises:
            ValueError: If depth <= 0 or num_samples < 2.
        """
        if depth is None:
            depth = self.DEFAULT_PROFILE_DEPTH
        
        if depth <= 0:
            raise ValueError("depth must be > 0")
        if num_samples < 2:
            raise ValueError("num_samples must be >= 2")
        
        profile = []
        extent = extent if extent is not None else self.DEFAULT_EXTENT
        
        element_positions = self.array.get_element_positions()
        weights = self.window.get_weights()

        # Normalize amplitudes by sum of weights (consistent with 2D map)
        total_weight = sum(weights) if weights else 1.0
        if total_weight <= 0:
            total_weight = 1.0
        
        for sample_idx in range(num_samples):
            # Position along horizontal line at given depth
            x_position = -extent + (2 * extent * sample_idx) / (num_samples - 1)
            y_position = depth
            
            # Compute complex field at this point
            real_sum = 0.0
            imag_sum = 0.0
            
            for n, (elem_x, elem_y) in enumerate(element_positions):
                # Distance from element to observation point
                dx = x_position - elem_x
                dy = y_position - elem_y
                distance = math.sqrt(dx * dx + dy * dy)
                
                if distance < 1e-6:
                    continue
                
                steer = steering_angles_deg[n] if steering_angles_deg is not None else steering_angle_deg
                # Invert sign so positive steering moves beam toward +X (right)
                steering_angle_rad = math.radians(-steer)
                
                # phase_n = -2π * (x_n*sin(theta) + y_n*cos(theta)) / λ
                steering_phase = -2.0 * math.pi * (
                    elem_x * math.sin(steering_angle_rad) + elem_y * math.cos(steering_angle_rad)
                ) / self.array.wavelength
                
                # Propagation phase
                propagation_phase = self.array.wave_number * distance
                
                # Total phase
                total_phase = propagation_phase + steering_phase
                
                # Amplitude with window weight and path loss (normalized)
                amplitude = (weights[n] * self.signal.amplitude / math.sqrt(distance)) / total_weight
                
                real_sum += amplitude * math.cos(total_phase)
                imag_sum += amplitude * math.sin(total_phase)
            
            # Magnitude at this point
            magnitude = math.sqrt(real_sum * real_sum + imag_sum * imag_sum)
            
            profile.append({
                "position": x_position,
                "amplitude": max(0.0, magnitude)
            })
        
        # Normalize profile so peak amplitude = 1.0 for consistent display
        if profile:
            peak_amp = max(p["amplitude"] for p in profile)
            if peak_amp > 1e-10:
                for p in profile:
                    p["amplitude"] = p["amplitude"] / peak_amp
        
        return profile
    
    def run_simulation(
        self,
        steering_angle_deg: float = 0,
        enable_noise: bool = False,
        grid_size: int = None,
        angle_step: float = None,
        profile_depth: float = None,
        steering_angles_deg: List[float] = None
    ) -> BeamformingResult:
        """Execute complete beamforming simulation.
        
        Orchestrates computation of beam patterns, metrics, 2D interference map,
        and 1D signal profile with optional noise injection.
        
        Args:
            steering_angle_deg: Main beam steering angle in degrees (default: 0).
            enable_noise: Whether to add SNR-based noise (default: False).
            grid_size: Grid resolution for 2D map (default: 60).
            angle_step: Angular step for beam pattern (default: 1.0°).
            profile_depth: Depth for 1D signal profile (default: 2.0 m).
        
        Returns:
            BeamformingResult with all simulation outputs.
        
        Raises:
            ValueError: If steering angle out of range or other parameter invalid.
        """
        if grid_size is None:
            grid_size = self.DEFAULT_GRID_SIZE
        if angle_step is None:
            angle_step = self.DEFAULT_ANGLE_STEP
        if profile_depth is None:
            profile_depth = self.DEFAULT_PROFILE_DEPTH
        
        # Validate parameters
        if steering_angle_deg < -90 or steering_angle_deg > 90:
            raise ValueError("steering_angle_deg must be in [-90, 90]")
        if grid_size < 2:
            raise ValueError("grid_size must be >= 2")
        if angle_step <= 0:
            raise ValueError("angle_step must be > 0")
        if profile_depth <= 0:
            raise ValueError("profile_depth must be > 0")
        
        # Compute steered beam pattern
        beam_pattern = self.compute_beam_pattern(steering_angle_deg, angle_step, steering_angles_deg)
        
        # Compute broadside beam pattern (reference)
        beam_pattern_no_steer = self.compute_beam_pattern(0, angle_step)
        
        # Compute metrics from steered beam
        metrics = self._compute_metrics(beam_pattern)
        
        # Compute array aperture (meters): N * element spacing
        aperture = self.array.num_elements * self.array.get_element_spacing_meters()

        # Determine dynamic extent so the array fits and some propagation distance
        # is visible. Use an aperture-based extent with a fixed padding rather
        # than a strict linear multiple so that element spacing produces
        # visually noticeable changes in the overlay markers (avoids
        # self-similar scaling which keeps markers at the same normalized
        # position). Cap to a reasonable maximum (100 * wavelength).
        max_extent = 100.0 * self.array.wavelength
        padding = 5.0 * self.array.wavelength
        dynamic_extent = aperture + padding
        dynamic_extent = max(self.DEFAULT_EXTENT, min(dynamic_extent, max_extent))

        # Generate 2D interference map using the computed extent
        interference_map = self.interference_map_engine.compute_2d_map(
            steering_angle_deg=steering_angle_deg,
            grid_size=grid_size,
            extent=dynamic_extent,
            apply_noise=enable_noise
        )

        # Compute Fraunhofer (far-field) distance and choose profile depth
        wavelength = self.array.wavelength
        fraunhofer_dist = 2.0 * (aperture ** 2) / max(wavelength, 1e-12)
        # Desired depth is at least the Fraunhofer distance, but cap to max_extent
        desired_profile_depth = max(profile_depth, fraunhofer_dist)
        final_profile_depth = min(desired_profile_depth, max_extent)

        # Compute 1D signal profile at the chosen depth and along the same extent
        signal_profile = self._compute_signal_profile(
            steering_angle_deg,
            depth=final_profile_depth,
            num_samples=max(80, 8 * self.array.num_elements),
            extent=dynamic_extent,
            steering_angles_deg=steering_angles_deg
        )
        
        return BeamformingResult(
            beam_pattern=beam_pattern,
            beam_pattern_no_steer=beam_pattern_no_steer,
            interference_map=interference_map,
            metrics=metrics,
            signal_profile=signal_profile
        )
    
    def get_configuration(self) -> dict:
        """Get current configuration of beamforming engine.
        
        Returns:
            Dictionary with array, signal, noise, and window parameters.
        """
        return {
            "array": {
                "num_elements": self.array.num_elements,
                "spacing_wavelengths": self.array.spacing,
                "frequency_hz": self.array.frequency,
                "wavelength_m": self.array.wavelength
            },
            "signal": {
                "frequency_hz": self.signal.frequency,
                "amplitude": self.signal.amplitude,
                "speed_m_s": self.signal.speed
            },
            "noise": {
                "snr_db": self.noise.snr_db,
                "enabled": self.noise.noise_enabled
            },
            "window": {
                "type": self.window.window_type,
                "num_elements": self.window.num_elements
            }
        }
    
    def __repr__(self) -> str:
        """String representation."""
        return (
            f"BeamformingEngine("
            f"elements={self.array.num_elements}, "
            f"freq={self.array.frequency/1e9:.1f}GHz, "
            f"window={self.window.window_type})"
        )