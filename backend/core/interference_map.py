"""2D interference map generation - OOP implementation"""

import math
from typing import List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class InterferenceMapResult:
    """Result of 2D interference map computation.
    
    Attributes:
        grid: 2D list of normalized field magnitudes [grid_size x grid_size].
        x_range: List of x-coordinates for grid points.
        y_range: List of y-coordinates (depths) for grid points.
        max_val: Maximum field magnitude in the grid.
        min_val: Minimum field magnitude in the grid.
        extent: Spatial extent of the map (±extent in x).
    """
    grid: List[List[float]]
    x_range: List[float]
    y_range: List[float]
    max_val: float
    min_val: float
    extent: float = 5.0


class InterferenceMap:
    """Computes 2D spatial interference patterns from antenna array.
    
    This class generates 2D maps of the complex field pattern produced by
    an antenna array, accounting for array geometry, steering, and noise.
    Used for visualization and analysis of beam characteristics.
    
    Attributes:
        array: ArrayModel instance defining array geometry.
        signal: SignalModel instance for phase/amplitude computations.
        noise: NoiseModel instance for noise injection.
        window: WindowFunction instance for apodization weights.
    """
    
    def __init__(self, array, signal, noise, window):
        """Initialize InterferenceMap with DSP components.
        
        Args:
            array: ArrayModel instance (provides element positions, wavelength).
            signal: SignalModel instance (provides frequency, speed of light).
            noise: NoiseModel instance (provides SNR-based noise).
            window: WindowFunction instance (provides element weights).
        """
        self.array = array
        self.signal = signal
        self.noise = noise
        self.window = window
    
    def compute_2d_map(
        self,
        steering_angle_deg: float,
        grid_size: int = 80,
        extent: float = 5.0,
        apply_noise: bool = False
    ) -> InterferenceMapResult:
        """Compute 2D interference map at all grid points.
        
        Computes the complex electromagnetic field at each point in a 2D grid
        by summing contributions from all array elements, accounting for steering,
        path delays, and noise.
        
        Args:
            steering_angle_deg: Main beam steering angle in degrees.
            grid_size: Resolution of grid (default: 80x80 points).
            extent: Spatial extent in x-direction: ±extent meters (default: 5.0).
            apply_noise: Whether to apply SNR-based noise (default: False).
        
        Returns:
            InterferenceMapResult with computed 2D field pattern.
        
        Raises:
            ValueError: If grid_size < 2 or extent <= 0.
        """
        if grid_size < 2:
            raise ValueError("grid_size must be >= 2")
        if extent <= 0:
            raise ValueError("extent must be > 0")
        
        steering_angle_rad = math.radians(steering_angle_deg)
        
        # Compute x and y coordinate ranges
        x_range = []
        y_range = []
        
        for i in range(grid_size):
            # X: symmetric around origin
            x = -extent + (2 * extent * i) / (grid_size - 1)
            x_range.append(x)
            
            # Y: positive depth into medium (0 to extent)
            y = (extent * i) / (grid_size - 1)
            y_range.append(y)
        
        # Compute grid of field magnitudes
        grid = []
        max_val = 0.0
        min_val = float('inf')
        
        # Get element positions and weights
        element_positions = self.array.get_element_positions()
        weights = self.window.get_weights()
        
        for yi in range(grid_size):
            row = []
            py = y_range[yi]
            
            for xi in range(grid_size):
                px = x_range[xi]
                
                # Compute complex field at this grid point
                real_sum = 0.0
                imag_sum = 0.0
                
                for n, (elem_x, elem_y) in enumerate(element_positions):
                    # Distance from element to observation point
                    dx = px - elem_x
                    dy = py - elem_y
                    distance = math.sqrt(dx * dx + dy * dy)
                    
                    # Avoid singularity at element location
                    if distance < 1e-6:
                        continue
                    
                    # phase_n = -2π * (x_n*sin(theta) + y_n*cos(theta)) / λ
                    steering_phase = -2.0 * math.pi * (
                        elem_x * math.sin(steering_angle_rad) + elem_y * math.cos(steering_angle_rad)
                    ) / self.array.wavelength
                    
                    # Propagation phase: k * distance
                    propagation_phase = self.array.wave_number * distance
                    
                    # Total phase at this element
                    total_phase = propagation_phase + steering_phase
                    
                    # Amplitude includes: element weight, apodization, path loss (1/r)
                    element_amplitude = weights[n] * self.signal.amplitude / math.sqrt(distance)
                    
                    # Complex field contribution from this element
                    real_sum += element_amplitude * math.cos(total_phase)
                    imag_sum += element_amplitude * math.sin(total_phase)
                
                # Magnitude of complex field
                magnitude = math.sqrt(real_sum * real_sum + imag_sum * imag_sum)
                
                # Apply noise if enabled
                if apply_noise:
                    magnitude = self.noise.add_noise_to_scalar(magnitude)
                
                # Ensure non-negative magnitude
                magnitude = max(0.0, magnitude)
                
                # Track min/max
                if magnitude > max_val:
                    max_val = magnitude
                if magnitude < min_val:
                    min_val = magnitude
                
                row.append(magnitude)
            
            grid.append(row)
        
        # Handle case where all values are identical (no variation)
        if min_val == float('inf'):
            min_val = 0.0
        
        return InterferenceMapResult(
            grid=grid,
            x_range=x_range,
            y_range=y_range,
            max_val=max_val,
            min_val=min_val,
            extent=extent
        )
    
    def get_beam_profile(
        self,
        angle_deg: float,
        distance: float = 2.0
    ) -> List[float]:
        """Get 1D radial beam profile at specific angle and distance.
        
        Computes field magnitude along a radial line at given angle,
        sampled at the specified distance from array.
        
        Args:
            angle_deg: Radial direction angle in degrees.
            distance: Distance from array to sample point in meters.
        
        Returns:
            List of magnitude samples along the radial line.
        """
        angle_rad = math.radians(angle_deg)
        
        # Sample points along radial line
        num_samples = 50
        profile = []
        element_positions = self.array.get_element_positions()
        weights = self.window.get_weights()
        
        for sample in range(num_samples):
            # Current distance sample
            current_distance = distance * (sample + 1) / num_samples
            
            # Point in 2D space at this angle and distance
            px = current_distance * math.cos(angle_rad)
            py = current_distance * math.sin(angle_rad)
            
            # Compute field at this point
            real_sum = 0.0
            imag_sum = 0.0
            
            for n, (elem_x, elem_y) in enumerate(element_positions):
                dx = px - elem_x
                dy = py - elem_y
                dist = math.sqrt(dx * dx + dy * dy)
                
                if dist < 1e-6:
                    continue
                
                # Phase computation (no steering for profile)
                phase = self.array.wave_number * dist
                amplitude = weights[n] * self.signal.amplitude / math.sqrt(dist)
                
                real_sum += amplitude * math.cos(phase)
                imag_sum += amplitude * math.sin(phase)
            
            magnitude = math.sqrt(real_sum * real_sum + imag_sum * imag_sum)
            profile.append(max(0.0, magnitude))
        
        return profile
    
    def get_directivity_index(self, beam_pattern: List[float]) -> float:
        """Compute directivity index from beam pattern.
        
        Directivity measures how concentrated the beam is:
        DI = 10 * log10(peak_gain / average_gain)
        
        Args:
            beam_pattern: List of normalized beam pattern magnitudes.
        
        Returns:
            Directivity index in dB (typically 10-30 dB).
        
        Raises:
            ValueError: If beam_pattern is empty or all zeros.
        """
        if not beam_pattern or all(v == 0 for v in beam_pattern):
            raise ValueError("beam_pattern must be non-empty and non-zero")
        
        peak_gain = max(beam_pattern)
        average_gain = sum(beam_pattern) / len(beam_pattern)
        
        if average_gain <= 0:
            return 0.0
        
        # Directivity in dB: 10*log10(peak/average)
        directivity_db = 10 * math.log10(peak_gain / average_gain)
        
        return directivity_db
    
    def get_main_lobe_width(
        self,
        beam_pattern: List[float],
        beam_pattern_angles: List[float]
    ) -> float:
        """Estimate main lobe width (-3dB beamwidth).
        
        Finds the angle range where beam pattern is within 3dB of peak.
        
        Args:
            beam_pattern: List of beam pattern magnitudes (normalized 0-1).
            beam_pattern_angles: Corresponding angles in degrees.
        
        Returns:
            3dB beamwidth in degrees.
        
        Raises:
            ValueError: If inputs empty or mismatched lengths.
        """
        if not beam_pattern or not beam_pattern_angles:
            raise ValueError("beam_pattern and beam_pattern_angles must be non-empty")
        if len(beam_pattern) != len(beam_pattern_angles):
            raise ValueError("beam_pattern and beam_pattern_angles must have same length")
        
        # Find peak
        peak_magnitude = max(beam_pattern)
        if peak_magnitude <= 0:
            return 0.0
        
        # 3dB threshold (0.707 of peak in linear, -3dB in log)
        threshold = peak_magnitude / math.sqrt(2)
        
        # Find indices where beam exceeds threshold
        above_threshold = [(i, angle) for i, (mag, angle) in enumerate(zip(beam_pattern, beam_pattern_angles)) 
                          if mag >= threshold]
        
        if not above_threshold:
            return 0.0
        
        # Width is difference between max and min angles
        angles_above = [angle for _, angle in above_threshold]
        beamwidth = max(angles_above) - min(angles_above)
        
        return beamwidth
    
    def get_sidelobe_level(self, beam_pattern: List[float]) -> float:
        """Compute peak sidelobe level relative to main lobe.
        
        Args:
            beam_pattern: List of normalized beam pattern magnitudes.
        
        Returns:
            Peak sidelobe level in dB relative to main lobe peak.
        """
        if not beam_pattern:
            return 0.0
        
        peak_magnitude = max(beam_pattern)
        if peak_magnitude <= 0:
            return 0.0
        
        # Find secondary peaks (sidelobes)
        # Simple approach: find local maxima
        sidelobes = []
        for i in range(1, len(beam_pattern) - 1):
            if beam_pattern[i] > beam_pattern[i-1] and beam_pattern[i] > beam_pattern[i+1]:
                # Local maximum (potential sidelobe)
                if beam_pattern[i] < peak_magnitude * 0.99:  # Not the main lobe
                    sidelobes.append(beam_pattern[i])
        
        if not sidelobes:
            return -40.0  # Very low sidelobes if none detected
        
        peak_sidelobe = max(sidelobes)
        if peak_sidelobe <= 0:
            return -40.0
        
        sll_db = 20 * math.log10(peak_sidelobe / peak_magnitude)
        return sll_db
