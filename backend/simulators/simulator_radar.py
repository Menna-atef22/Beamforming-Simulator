"""Radar simulator with target tracking and range-Doppler processing - OOP implementation"""

import math
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field

from ..core.beamforming_engine import BeamformingEngine, BeamformingResult
from ..core.array_model import ArrayModel
from ..core.signal_model import SignalModel
from ..core.noise_model import NoiseModel
from ..core.window_functions import WindowFunction


@dataclass
class RadarTarget:
    """Radar target with RCS and Doppler velocity.
    
    Attributes:
        id: Unique target identifier.
        angle_deg: Target bearing in degrees [-180, 180].
        distance_m: Target range in meters.
        rcs_dbsm: Radar cross-section in dBsm (dB square meters).
        velocity_mps: Radial velocity in m/s (positive = receding).
        amplitude: Target signal amplitude (0-1).
    """
    id: int
    angle_deg: float
    distance_m: float
    rcs_dbsm: float = 0.0
    velocity_mps: float = 0.0
    amplitude: float = 1.0


@dataclass
class DetectedPeak:
    """Radar detection with signal metrics.
    
    Attributes:
        angle_deg: Detection bearing.
        distance_m: Estimated range.
        snr_db: Signal-to-noise ratio.
        power: Received power (linear).
        confidence: Detection confidence (0-1).
    """
    angle_deg: float
    distance_m: float
    snr_db: float
    power: float
    confidence: float


@dataclass
class RadarScanResult:
    """Complete radar scan result.
    
    Attributes:
        angles_deg: Angle grid for scan.
        magnitudes: Raw received power (linear).
        magnitudes_db: Received power in dB.
        targets: List of known targets.
        detections: List of detected peaks.
        range_doppler_map: 2D range-Doppler heatmap.
        metrics: Performance metrics (detection rate, false alarms).
    """
    angles_deg: List[float]
    magnitudes: List[float]
    magnitudes_db: List[float]
    targets: List[RadarTarget]
    detections: List[DetectedPeak]
    range_doppler_map: Dict
    metrics: Dict
    noise_buffer: List[float]


class SimulatorRadar(BeamformingEngine):
    """Radar simulator with target tracking and range-Doppler processing.
    
    This class extends BeamformingEngine to simulate a radar system with multiple
    targets, range/Doppler estimation, and signal processing.
    
    Attributes:
        targets: List of RadarTarget instances being tracked.
        detection_threshold_db: Threshold for peak detection in dB.
        clutter_level_db: Environmental clutter level in dB.
        unambiguous_range_m: Maximum unambiguous range in meters.
    """
    
    # Radar equation constants
    RADAR_POWER = 1.0  # Transmitted power (normalized)
    SYSTEM_LOSS_DB = 2.0  # Cable/component losses in dB
    
    def __init__(
        self,
        num_elements: int = 32,
        spacing: float = 0.5,
        frequency: float = 10e9,
        snr_db: float = 15,
        window_type: str = "hamming",
        amplitude: float = 1.0,
        detection_threshold_db: float = 5.0,
        clutter_level_db: float = -20.0
    ):
        """Initialize radar simulator with antenna and signal processing parameters.
        
        Args:
            num_elements: Number of antenna elements (default: 32).
            spacing: Element spacing in wavelengths (default: 0.5).
            frequency: Operating frequency in Hz (default: 10 GHz).
            snr_db: Signal-to-noise ratio in dB (default: 15).
            window_type: Apodization window type (default: "hamming").
            amplitude: Reference signal amplitude (default: 1.0).
            detection_threshold_db: Detection threshold in dB (default: 5.0).
            clutter_level_db: Clutter level in dB (default: -20.0 dB).
        
        Raises:
            ValueError: If parameters invalid.
        """
        # Initialize parent BeamformingEngine
        array = ArrayModel(num_elements, spacing, frequency, amplitude, 3e8)
        signal = SignalModel(frequency, 3e8, amplitude)
        noise = NoiseModel(snr_db)
        window = WindowFunction(window_type, num_elements)
        
        super().__init__(array, signal, noise, window)
        
        # Radar-specific parameters
        self.targets: List[RadarTarget] = []
        self.detection_threshold_db: float = detection_threshold_db
        self.clutter_level_db: float = clutter_level_db
        
        # Unambiguous range = c / (2 * PRF)
        # Assume PRF = 10 kHz typical for 10 GHz radar
        self.unambiguous_range_m = 3e8 / (2 * 10000)
        
        # Initialize with default targets
        self._setup_default_targets()
    
    def _setup_default_targets(self) -> None:
        """Set up default radar scenario with 4 targets."""
        self.add_target(target_id=1, angle_deg=30, distance_m=4000, rcs_dbsm=0)
        self.add_target(target_id=2, angle_deg=-45, distance_m=6000, rcs_dbsm=-2)
        self.add_target(target_id=3, angle_deg=70, distance_m=3000, rcs_dbsm=-1)
        self.add_target(target_id=4, angle_deg=-20, distance_m=8000, rcs_dbsm=-3)
    
    def add_target(
        self,
        target_id: int,
        angle_deg: float,
        distance_m: float,
        rcs_dbsm: float = 0.0,
        velocity_mps: float = 0.0
    ) -> RadarTarget:
        """Add target to radar scenario.
        
        Args:
            target_id: Unique target identifier.
            angle_deg: Target bearing in degrees.
            distance_m: Range to target in meters.
            rcs_dbsm: Radar cross-section in dBsm (default: 0).
            velocity_mps: Radial velocity in m/s (default: 0).
        
        Returns:
            The created RadarTarget instance.
        
        Raises:
            ValueError: If target_id already exists.
        """
        if any(t.id == target_id for t in self.targets):
            raise ValueError(f"Target {target_id} already exists")
        
        target = RadarTarget(
            id=target_id,
            angle_deg=angle_deg,
            distance_m=distance_m,
            rcs_dbsm=rcs_dbsm,
            velocity_mps=velocity_mps,
            amplitude=1.0
        )
        self.targets.append(target)
        return target
    
    def remove_target(self, target_id: int) -> bool:
        """Remove target from radar scenario.
        
        Args:
            target_id: ID of target to remove.
        
        Returns:
            True if removed, False if not found.
        """
        for i, target in enumerate(self.targets):
            if target.id == target_id:
                self.targets.pop(i)
                return True
        return False
    
    def _compute_radar_signal(
        self,
        target: RadarTarget,
        observation_angle_deg: float,
        steering_angle_deg: float
    ) -> float:
        """Compute received signal from target using radar equation.
        
        Radar Equation:
        P_r = (P_t * G^2 * λ^2 * σ) / ((4π)^3 * R^4 * L)
        
        Args:
            target: RadarTarget instance.
            observation_angle_deg: Beam observation angle.
            steering_angle_deg: Beam steering angle.
        
        Returns:
            Received power (linear scale, not dB).
        """
        # Antenna gain at target angle
        af_value = self.array.compute_af(
            angles_deg=[target.angle_deg],
            steering_angle_deg=steering_angle_deg,
            weights=self.window.get_weights()
        )[0]
        
        gain_linear = af_value * af_value  # Gain squared for transmit/receive
        
        # Convert RCS from dBsm to square meters
        rcs_linear = 10 ** (target.rcs_dbsm / 10)
        
        # Radar equation numerator
        wavelength = self.signal.wavelength
        numerator = (self.RADAR_POWER * gain_linear * wavelength ** 2 * rcs_linear)
        
        # Range loss (4π term and R^4)
        range_loss = (4 * math.pi) ** 3 * (target.distance_m ** 4)
        
        # System loss
        system_loss_linear = 10 ** (self.SYSTEM_LOSS_DB / 10)
        
        # Received power
        p_r = numerator / (range_loss * system_loss_linear)
        
        return p_r
    
    def _estimate_doppler_shift(
        self,
        target: RadarTarget
    ) -> float:
        """Estimate Doppler frequency shift from target velocity.
        
        Doppler shift: f_d = (2 * v * f_0) / c
        
        Args:
            target: RadarTarget with velocity.
        
        Returns:
            Doppler frequency shift in Hz.
        """
        if target.velocity_mps == 0:
            return 0.0
        
        doppler_shift = (2 * target.velocity_mps * self.signal.frequency) / 3e8
        return doppler_shift
    
    def _detect_peaks(
        self,
        angles_deg: List[float],
        magnitudes: List[float],
        threshold_db: float
    ) -> List[DetectedPeak]:
        """Detect peaks in magnitude profile above threshold.
        
        Uses local maxima detection with hysteresis thresholding.
        
        Args:
            angles_deg: Angle grid.
            magnitudes: Magnitude values (linear scale).
            threshold_db: Detection threshold in dB.
        
        Returns:
            List of DetectedPeak instances.
        """
        detections = []
        
        if len(magnitudes) < 3:
            return detections
        
        # Convert threshold to linear scale
        threshold_linear = 10 ** (threshold_db / 20)
        
        # Find peaks (local maxima)
        for i in range(1, len(magnitudes) - 1):
            if magnitudes[i] > magnitudes[i-1] and magnitudes[i] > magnitudes[i+1]:
                if magnitudes[i] > threshold_linear:
                    # Convert magnitude to dB SNR
                    magnitude_db = 20 * math.log10(max(magnitudes[i], 1e-10))
                    snr_db = magnitude_db - 10 * math.log10(self.noise.snr_db + 1)
                    
                    # Confidence based on peak prominence
                    prominence = magnitudes[i] - min(magnitudes[i-1], magnitudes[i+1])
                    confidence = min(prominence / magnitudes[i], 1.0)
                    
                    peak = DetectedPeak(
                        angle_deg=angles_deg[i],
                        distance_m=self.unambiguous_range_m / 2,  # Assume mid-range
                        snr_db=snr_db,
                        power=magnitudes[i],
                        confidence=confidence
                    )
                    detections.append(peak)
        
        return detections
    
    def run(
        self,
        steering_angle_deg: float = 0,
        scan_range_deg: float = 360,
        enable_noise: bool = True,
        grid_size: int = 360,
        compute_doppler: bool = True
    ) -> RadarScanResult:
        """Execute radar scan with target detection and range-Doppler processing.
        
        Args:
            steering_angle_deg: Main beam steering angle (default: 0).
            scan_range_deg: Angular scan range in degrees (default: 360).
            enable_noise: Whether to add thermal noise (default: True).
            grid_size: Number of angle bins (default: 360).
            compute_doppler: Whether to compute range-Doppler map (default: True).
        
        Returns:
            RadarScanResult with detections, targets, and metrics.
        """
        # Update noise settings
        if enable_noise:
            self.noise.enable_noise()
        else:
            self.noise.disable_noise()
        
        # Generate angle grid
        start_angle = steering_angle_deg - scan_range_deg / 2
        end_angle = steering_angle_deg + scan_range_deg / 2
        angles_deg = [start_angle + (end_angle - start_angle) * i / (grid_size - 1)
                      for i in range(grid_size)]
        
        magnitudes = []
        magnitudes_db = []
        
        # Compute received power at each angle
        for angle in angles_deg:
            total_power = 0.0
            
            # Sum contributions from all targets
            for target in self.targets:
                target_power = self._compute_radar_signal(
                    target, angle, steering_angle_deg
                )
                
                # Add clutter (environmental reflections)
                clutter_linear = 10 ** (self.clutter_level_db / 20)
                target_power += clutter_linear
                
                # Add thermal noise
                if enable_noise:
                    noise_power = self.noise.get_noise_power()
                    target_power += noise_power
                
                total_power += target_power
            
            magnitudes.append(total_power)
            magnitude_db = 20 * math.log10(max(total_power, 1e-10))
            magnitudes_db.append(magnitude_db)
        
        # Detect peaks above threshold
        detections = self._detect_peaks(angles_deg, magnitudes, self.detection_threshold_db)
        
        # Compute range-Doppler map if requested
        range_doppler_map = {}
        if compute_doppler:
            doppler_shifts = [self._estimate_doppler_shift(t) for t in self.targets]
            range_doppler_map = {
                "ranges_m": [t.distance_m for t in self.targets],
                "doppler_shifts_hz": doppler_shifts,
                "velocities_mps": [t.velocity_mps for t in self.targets]
            }
        
        # Compute performance metrics
        num_targets = len(self.targets)
        num_detections = len(detections)
        detection_rate = num_detections / max(num_targets, 1) if num_targets > 0 else 0
        
        metrics = {
            "num_targets": num_targets,
            "num_detections": num_detections,
            "detection_rate": detection_rate,
            "false_alarms": max(0, num_detections - num_targets),
            "avg_snr_db": sum(d.snr_db for d in detections) / max(len(detections), 1),
            "avg_confidence": sum(d.confidence for d in detections) / max(len(detections), 1)
        }
        
        noise_buffer = [0.0] * 360
        if enable_noise:
            # We use an arbitrary amplitude of 1.0 for the visual chart reference noise.
            noise_buffer = self.noise.add_noise_to_array(noise_buffer)
            
        return RadarScanResult(
            angles_deg=angles_deg,
            magnitudes=magnitudes,
            magnitudes_db=magnitudes_db,
            targets=self.targets.copy(),
            detections=detections,
            range_doppler_map=range_doppler_map,
            metrics=metrics,
            noise_buffer=noise_buffer
        )
    
    def get_range_profile(self, num_samples: int = 100) -> Dict:
        """Generate range profile (power vs range) for all targets.
        
        Args:
            num_samples: Number of range bins.
        
        Returns:
            Dictionary with range axis and power profile.
        """
        max_range = self.unambiguous_range_m
        ranges = [max_range * i / (num_samples - 1) for i in range(num_samples)]
        profile = []
        
        for range_m in ranges:
            total_power = 0.0
            
            for target in self.targets:
                # Simplified range profile: peak power at target range
                range_diff = abs(range_m - target.distance_m)
                resolution = max_range / num_samples
                
                # Gaussian range resolution cell
                power = self._compute_radar_signal(
                    target, target.angle_deg, 0
                ) * math.exp(-(range_diff ** 2) / (2 * resolution ** 2))
                total_power += power
            
            profile.append(total_power)
        
        return {
            "ranges_m": ranges,
            "max_range_m": max_range,
            "profile": profile
        }
    
    def get_doppler_profile(self, num_samples: int = 100) -> Dict:
        """Generate Doppler velocity profile for all targets.
        
        Args:
            num_samples: Number of Doppler bins.
        
        Returns:
            Dictionary with velocity axis and power profile.
        """
        max_velocity = 100.0  # m/s max measurable velocity
        velocities = [-max_velocity + 2 * max_velocity * i / (num_samples - 1)
                      for i in range(num_samples)]
        profile = []
        
        for vel in velocities:
            total_power = 0.0
            
            for target in self.targets:
                # Gaussian velocity resolution cell
                vel_diff = abs(vel - target.velocity_mps)
                resolution = 2 * max_velocity / num_samples
                
                power = self._compute_radar_signal(
                    target, target.angle_deg, 0
                ) * math.exp(-(vel_diff ** 2) / (2 * resolution ** 2))
                total_power += power
            
            profile.append(total_power)
        
        return {
            "velocities_mps": velocities,
            "max_velocity_mps": max_velocity,
            "profile": profile
        }
