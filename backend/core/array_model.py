"""Antenna array model with linear and curved geometry support - OOP implementation"""

import math
from typing import List, Literal
from dataclasses import dataclass


@dataclass
class ArrayElement:
    """Represents a single antenna element in the array.
    
    Attributes:
        index: Element index in the array (0-based).
        x: X position in meters.
        y: Y position in meters.
        amplitude: Amplitude weighting for this element.
        phase: Phase shift for this element in radians.
    """
    index: int
    x: float
    y: float
    amplitude: float
    phase: float


class ArrayModel:
    """Models an antenna array and computes array-related parameters.
    
    This class encapsulates the geometry and signal processing operations
    for a uniform linear antenna array (ULA), including element positioning,
    steering vector computation, and array factor calculations.
    
    Attributes:
        num_elements: Number of antenna elements in the array.
        spacing: Element spacing in wavelengths.
        frequency: Operating frequency in Hz.
        wavelength: Wavelength at operating frequency in meters.
        amplitude: Reference amplitude for array elements.
        elements: List of ArrayElement instances.
    """
    
    def __init__(
        self,
        num_elements: int,
        spacing: float,
        frequency: float,
        amplitude: float = 1.0,
        speed_of_light: float = 3e8,
        geometry: Literal["linear", "curved"] = "linear",
        radius: float = 5.0
    ) -> None:
        """Initialize ArrayModel with array parameters.
        
        Args:
            num_elements: Number of elements in the linear array.
            spacing: Element spacing in wavelengths (typically 0.5 for λ/2).
            frequency: Operating frequency in Hz.
            amplitude: Reference amplitude for all elements (default 1.0).
            speed_of_light: Propagation speed in m/s (default: 3e8).
            geometry: Array geometry, either "linear" or "curved".
            radius: Curvature radius in wavelength units (used for curved geometry).
        
        Raises:
            ValueError: If num_elements < 1, spacing <= 0, frequency <= 0, or radius <= 0.
        """
        if num_elements < 1:
            raise ValueError("num_elements must be >= 1")
        if spacing <= 0:
            raise ValueError("spacing must be > 0")
        if frequency <= 0:
            raise ValueError("frequency must be > 0")
        if amplitude <= 0:
            raise ValueError("amplitude must be > 0")
        if radius <= 0:
            raise ValueError("radius must be > 0")
        if geometry not in ("linear", "curved"):
            raise ValueError("geometry must be either 'linear' or 'curved'")
        
        self.num_elements: int = num_elements
        self.spacing: float = spacing
        self.frequency: float = frequency
        self.amplitude: float = amplitude
        self.geometry: Literal["linear", "curved"] = geometry
        self.radius: float = radius
        
        # Compute wavelength: λ = c / f
        self.wavelength: float = speed_of_light / frequency
        
        # Compute wave number: k = 2π / λ
        self.wave_number: float = (2 * math.pi) / self.wavelength
        
        # Create array elements according to selected geometry
        self.elements: List[ArrayElement] = self._create_elements()
    
    def _create_elements(self) -> List[ArrayElement]:
        """Create linear array elements with centered positioning.
        
        Elements are positioned symmetrically around the origin along the x-axis.
        Each element is initialized with zero phase.
        
        Returns:
            List of ArrayElement instances.
        """
        elements = []
        
        center = (self.num_elements - 1) / 2.0
        d_m = self.spacing * self.wavelength
        r_m = self.radius * self.wavelength
        
        for n in range(self.num_elements):
            n_centered = n - center

            if self.geometry == "curved":
                # alpha_n = (n - (N-1)/2) * d / R  [radians]
                alpha_n = (n_centered * d_m) / r_m
                # x_n = R * sin(alpha_n), y_n = R * (1 - cos(alpha_n))
                x_position = r_m * math.sin(alpha_n)
                y_position = r_m * (1.0 - math.cos(alpha_n))
            else:
                # x_n = (n - (N-1)/2) * d, y_n = 0
                x_position = n_centered * d_m
                y_position = 0.0
            elements.append(
                ArrayElement(
                    index=n,
                    x=x_position,
                    y=y_position,
                    amplitude=self.amplitude,
                    phase=0.0
                )
            )
        
        return elements
    
    def get_element_positions(self) -> List[tuple]:
        """Get (x, y) coordinates of all array elements.
        
        Returns:
            List of (x, y) coordinate tuples in meters.
        """
        return [(elem.x, elem.y) for elem in self.elements]
    
    def compute_steering_vector(self, angle_deg: float) -> List[complex]:
        """Compute steering vector for a given angle.
        
        The steering vector defines the phase shifts required at each element
        to steer the main beam toward a specific angle. Used for beamforming.
        
        Args:
            angle_deg: Target steering angle in degrees.
        
        Returns:
            List of complex steering vector values (one per element).
        """
        angle_rad = math.radians(angle_deg)
        steering_vector = []
        
        for elem in self.elements:
            if self.geometry == "curved":
                steering_phase = 2.0 * math.pi * (
                    elem.x * math.cos(angle_rad) + elem.y * math.sin(angle_rad)
                ) / self.wavelength
            else:
                steering_phase = -2.0 * math.pi * (
                    elem.x * math.sin(angle_rad) + elem.y * math.cos(angle_rad)
                ) / self.wavelength
            
            # Steering vector component: exp(j * phase_n)
            sv_component = complex(
                math.cos(steering_phase),
                math.sin(steering_phase)
            )
            steering_vector.append(sv_component)
        
        return steering_vector
    
    def compute_af(
        self,
        angles_deg: List[float],
        steering_angle_deg: float,
        weights: List[float] = None
    ) -> List[float]:
        """Compute Array Factor (AF) magnitude across a range of angles.
        
        The Array Factor represents the normalized antenna gain pattern
        contribution from the array geometry (independent of element pattern).
        
        Args:
            angles_deg: List of angles to compute AF (in degrees).
            steering_angle_deg: Main beam steering angle (in degrees).
            weights: Optional amplitude weights for each element (default: uniform).
        
        Returns:
            List of Array Factor magnitudes (normalized).
        
        Raises:
            ValueError: If weights length doesn't match num_elements.
        """
        if weights is None:
            weights = [1.0] * self.num_elements
        
        if len(weights) != self.num_elements:
            raise ValueError(
                f"weights length ({len(weights)}) must match "
                f"num_elements ({self.num_elements})"
            )
        
        steer_rad = math.radians(steering_angle_deg)
        af_values = []
        
        for angle_deg in angles_deg:
            angle_rad = math.radians(angle_deg)
            real_sum = 0.0
            imag_sum = 0.0
            
            for n, elem in enumerate(self.elements):
                if self.geometry == "curved":
                    obs_phase = 2.0 * math.pi * (
                        elem.x * math.cos(angle_rad) + elem.y * math.sin(angle_rad)
                    ) / self.wavelength
                    steer_phase = 2.0 * math.pi * (
                        elem.x * math.cos(steer_rad) + elem.y * math.sin(steer_rad)
                    ) / self.wavelength
                else:
                    obs_phase = -2.0 * math.pi * (
                        elem.x * math.sin(angle_rad) + elem.y * math.cos(angle_rad)
                    ) / self.wavelength
                    steer_phase = -2.0 * math.pi * (
                        elem.x * math.sin(steer_rad) + elem.y * math.cos(steer_rad)
                    ) / self.wavelength
                
                phase = obs_phase - steer_phase
                
                # Element factor (suppress back lobe for curved arrays)
                elem_factor = 1.0
                if self.geometry == "curved":
                    # Facing angle is alpha_n, relative to broadside (0)
                    center = (self.num_elements - 1) / 2.0
                    alpha_n = ((n - center) * self.spacing * self.wavelength) / (self.radius * self.wavelength)
                    # angle_diff = angle_rad - alpha_n
                    angle_diff = angle_rad - alpha_n
                    # Apply cosine element factor, 0 if behind element
                    elem_factor = max(0.0, math.cos(angle_diff))

                # Weighted amplitude and phase
                w = weights[n] * elem_factor
                real_sum += w * math.cos(phase)
                imag_sum += w * math.sin(phase)
            
            # Array Factor magnitude
            af_mag = math.sqrt(real_sum**2 + imag_sum**2)
            
            # Normalize by total weight
            total_weight = sum(weights)
            if total_weight > 0:
                af_mag /= total_weight
            
            af_values.append(af_mag)
        
        return af_values
    
    def compute_multi_steered_af(
        self,
        angles_deg: List[float],
        steering_angles_deg: List[float],
        weights: List[float] = None
    ) -> List[float]:
        """Compute Array Factor with independent steering angle per element.
        
        Args:
            angles_deg: List of observation angles (in degrees).
            steering_angles_deg: Main beam steering angle per element (in degrees).
                                Must match num_elements.
            weights: Optional amplitude weights for each element (default: uniform).
            
        Returns:
            List of Array Factor magnitudes (normalized).
        """
        if weights is None:
            weights = [1.0] * self.num_elements
            
        if len(weights) != self.num_elements:
            raise ValueError(f"weights length ({len(weights)}) must match num_elements")
            
        if len(steering_angles_deg) != self.num_elements:
            raise ValueError(f"steering_angles_deg length ({len(steering_angles_deg)}) must match num_elements")
            
        af_values = []
        for angle_deg in angles_deg:
            angle_rad = math.radians(angle_deg)
            real_sum = 0.0
            imag_sum = 0.0
            
            for n, (elem, steer_deg) in enumerate(zip(self.elements, steering_angles_deg)):
                steer_rad = math.radians(steer_deg)
                
                if self.geometry == "curved":
                    obs_phase = 2.0 * math.pi * (
                        elem.x * math.cos(angle_rad) + elem.y * math.sin(angle_rad)
                    ) / self.wavelength
                    steer_phase = 2.0 * math.pi * (
                        elem.x * math.cos(steer_rad) + elem.y * math.sin(steer_rad)
                    ) / self.wavelength
                else:
                    obs_phase = -2.0 * math.pi * (
                        elem.x * math.sin(angle_rad) + elem.y * math.cos(angle_rad)
                    ) / self.wavelength
                    steer_phase = -2.0 * math.pi * (
                        elem.x * math.sin(steer_rad) + elem.y * math.cos(steer_rad)
                    ) / self.wavelength
                
                phase = obs_phase - steer_phase
                
                elem_factor = 1.0
                if self.geometry == "curved":
                    center = (self.num_elements - 1) / 2.0
                    alpha_n = ((n - center) * self.spacing * self.wavelength) / (self.radius * self.wavelength)
                    elem_factor = max(0.0, math.cos(angle_rad - alpha_n))

                w = weights[n] * elem_factor
                real_sum += w * math.cos(phase)
                imag_sum += w * math.sin(phase)
            
            af_mag = math.sqrt(real_sum**2 + imag_sum**2)
            total_weight = sum(weights)
            if total_weight > 0:
                af_mag /= total_weight
            af_values.append(af_mag)
            
        return af_values
    
    def get_element_spacing_meters(self) -> float:
        """Get element spacing in physical meters.
        
        Returns:
            Element spacing in meters (spacing * wavelength).
        """
        return self.spacing * self.wavelength
