"""Linear antenna array model - OOP implementation"""

import math
from typing import List
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
    """Models a linear antenna array and computes array-related parameters.
    
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
        speed_of_light: float = 3e8
    ) -> None:
        """Initialize ArrayModel with array parameters.
        
        Args:
            num_elements: Number of elements in the linear array.
            spacing: Element spacing in wavelengths (typically 0.5 for λ/2).
            frequency: Operating frequency in Hz.
            amplitude: Reference amplitude for all elements (default 1.0).
            speed_of_light: Propagation speed in m/s (default: 3e8).
        
        Raises:
            ValueError: If num_elements < 1, spacing <= 0, or frequency <= 0.
        """
        if num_elements < 1:
            raise ValueError("num_elements must be >= 1")
        if spacing <= 0:
            raise ValueError("spacing must be > 0")
        if frequency <= 0:
            raise ValueError("frequency must be > 0")
        if amplitude <= 0:
            raise ValueError("amplitude must be > 0")
        
        self.num_elements: int = num_elements
        self.spacing: float = spacing
        self.frequency: float = frequency
        self.amplitude: float = amplitude
        
        # Compute wavelength: λ = c / f
        self.wavelength: float = speed_of_light / frequency
        
        # Compute wave number: k = 2π / λ
        self.wave_number: float = (2 * math.pi) / self.wavelength
        
        # Create linear array elements
        self.elements: List[ArrayElement] = self._create_elements()
    
    def _create_elements(self) -> List[ArrayElement]:
        """Create linear array elements with centered positioning.
        
        Elements are positioned symmetrically around the origin along the x-axis.
        Each element is initialized with zero phase.
        
        Returns:
            List of ArrayElement instances.
        """
        elements = []
        
        # Center the array: offset = (N-1) * d / 2
        offset = ((self.num_elements - 1) * self.spacing * self.wavelength) / 2
        
        for n in range(self.num_elements):
            x_position = n * self.spacing * self.wavelength - offset
            elements.append(
                ArrayElement(
                    index=n,
                    x=x_position,
                    y=0.0,
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
            # Steering phase: φ = k * x * sin(θ)
            steering_phase = self.wave_number * elem.x * math.sin(angle_rad)
            
            # Steering vector component: exp(-j * φ)
            sv_component = complex(
                math.cos(-steering_phase),
                math.sin(-steering_phase)
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
                # Phase contribution: φ = k * x * (sin(θ) - sin(θ_steer))
                phase = self.wave_number * elem.x * (math.sin(angle_rad) - math.sin(steer_rad))
                
                # Weighted amplitude and phase
                w = weights[n]
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
    
    def get_element_spacing_meters(self) -> float:
        """Get element spacing in physical meters.
        
        Returns:
            Element spacing in meters (spacing * wavelength).
        """
        return self.spacing * self.wavelength
