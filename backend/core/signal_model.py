"""Signal and wave propagation models - OOP implementation"""
import math
from typing import Tuple, List


class SignalModel:
    """
    Encapsulates signal propagation and phase computations.
    
    This class models electromagnetic wave propagation, including phase shifts,
    propagation delays, and amplitude decay due to free-space path loss.
    """
    
    def __init__(
        self,
        frequency: float,
        speed: float,
        amplitude: float
    ) -> None:
        """
        Initialize SignalModel with propagation parameters.
        
        Args:
            frequency: Operating frequency in Hz.
            speed: Propagation speed (e.g., speed of light 3e8 m/s).
            amplitude: Reference signal amplitude.
        
        Raises:
            ValueError: If frequency <= 0, speed <= 0, or amplitude <= 0.
        """
        if frequency <= 0:
            raise ValueError("frequency must be > 0")
        if speed <= 0:
            raise ValueError("speed must be > 0")
        if amplitude <= 0:
            raise ValueError("amplitude must be > 0")
        
        self.frequency: float = frequency
        self.speed: float = speed
        self.amplitude: float = amplitude
        
        # Wavelength λ = c / f
        self.wavelength: float = speed / frequency
        
        # Wave number k = 2π / λ
        self.wave_number: float = (2 * math.pi) / self.wavelength
        
        # Angular frequency ω = 2πf
        self.angular_frequency: float = 2 * math.pi * frequency
    
    def compute_phase_shift(self, distance: float) -> float:
        """
        Compute phase shift accumulated over a given distance.
        
        The phase shift represents how much the wave phase changes as it
        propagates through a distance in the medium.
        
        Args:
            distance: Propagation distance in meters (must be >= 0).
        
        Returns:
            Phase shift in radians.
        
        Raises:
            ValueError: If distance < 0.
        """
        if distance < 0:
            raise ValueError("distance must be >= 0")
        
        # Phase shift: φ = k * distance = (2π/λ) * distance
        phase_shift = self.wave_number * distance
        return phase_shift
    
    def compute_propagation_delay(self, distance: float) -> float:
        """
        Compute propagation delay (time) for a given distance.
        
        The propagation delay represents the time it takes for the wave
        to travel a given distance.
        
        Args:
            distance: Propagation distance in meters (must be >= 0).
        
        Returns:
            Propagation delay in seconds.
        
        Raises:
            ValueError: If distance < 0.
        """
        if distance < 0:
            raise ValueError("distance must be >= 0")
        
        # Time delay: τ = distance / speed
        delay = distance / self.speed
        return delay
    
    def compute_amplitude_decay(self, distance: float) -> float:
        """
        Compute amplitude decay due to free-space path loss.
        
        Models spherical spreading loss (1/r) in isotropic radiation.
        Amplitude decays inversely with distance.
        
        Args:
            distance: Propagation distance in meters (must be > 0).
        
        Returns:
            Amplitude decay factor (0 to 1). Original amplitude is
            multiplied by this factor.
        
        Raises:
            ValueError: If distance <= 0.
        """
        if distance <= 0:
            raise ValueError("distance must be > 0")
        
        # Free-space path loss: A(r) = A0 / r (spherical spreading)
        # Normalized so that at r=1m, decay = 1.0
        decay = 1.0 / distance
        
        # Clamp to [0, 1] range
        return min(decay, 1.0)
    
    def get_element_signal(
        self,
        base_phase: float,
        additional_phase: float
    ) -> dict:
        """
        Compute real and imaginary components of a signal.
        
        Represents a complex signal as I/Q (in-phase/quadrature) components.
        
        Args:
            base_phase: Base phase angle in radians.
            additional_phase: Additional phase shift in radians.
        
        Returns:
            Dictionary with keys:
            - 'real': Real (I) component = amplitude * cos(phase)
            - 'imag': Imaginary (Q) component = amplitude * sin(phase)
        """
        total_phase = base_phase + additional_phase
        return {
            "real": self.amplitude * math.cos(total_phase),
            "imag": self.amplitude * math.sin(total_phase)
        }


# Legacy functions for backward compatibility

def wave_number(wavelength: float) -> float:
    """
    Legacy function to calculate wave number from wavelength.
    
    DEPRECATED: Use SignalModel.wave_number property instead.
    
    Args:
        wavelength: Wavelength in meters.
    
    Returns:
        Wave number k = 2π / λ in rad/m.
    """
    return (2 * math.pi) / wavelength


def phase_shift(k: float, n: int, d: float, theta_rad: float) -> float:
    """
    Legacy function to calculate phase shift for array element.
    
    DEPRECATED: Use ArrayModel.compute_steering_vector() instead.
    
    Args:
        k: Wave number in rad/m.
        n: Element index (0-based).
        d: Element spacing in wavelengths.
        theta_rad: Angle in radians.
    
    Returns:
        Phase shift in radians: k * n * d * sin(θ).
    """
    return k * n * d * math.sin(theta_rad)


def element_signal(
    amplitude: float,
    phase: float,
    additional_phase: float
) -> dict:
    """
    Legacy function to calculate element signal components.
    
    DEPRECATED: Use SignalModel.get_element_signal() instead.
    
    Args:
        amplitude: Signal amplitude.
        phase: Base phase in radians.
        additional_phase: Additional phase shift in radians.
    
    Returns:
        Dictionary with 'real' and 'imag' keys.
    """
    total_phase = phase + additional_phase
    return {
        "real": amplitude * math.cos(total_phase),
        "imag": amplitude * math.sin(total_phase)
    }


def array_factor(
    num_elements: int,
    spacing: float,
    wavelength: float,
    steering_angle_rad: float,
    theta_rad: float,
    amplitude: float = 1.0
) -> float:
    """
    Legacy function to calculate array factor without weighting.
    
    DEPRECATED: Use ArrayModel.compute_af() instead.
    
    Args:
        num_elements: Number of array elements.
        spacing: Element spacing in wavelengths.
        wavelength: Operating wavelength.
        steering_angle_rad: Steering angle in radians.
        theta_rad: Observation angle in radians.
        amplitude: Element amplitude.
    
    Returns:
        Normalized magnitude of array factor.
    """
    k = wave_number(wavelength)
    real = 0
    imag = 0
    
    for n in range(num_elements):
        steering_phase = phase_shift(k, n, spacing, steering_angle_rad)
        observe_phase = phase_shift(k, n, spacing, theta_rad)
        phase = observe_phase - steering_phase
        real += amplitude * math.cos(phase)
        imag += amplitude * math.sin(phase)
    
    return math.sqrt(real * real + imag * imag) / num_elements


def array_factor_weighted(
    num_elements: int,
    spacing: float,
    wavelength: float,
    steering_angle_rad: float,
    theta_rad: float,
    amplitude: float,
    weights: List[float]
) -> float:
    """
    Legacy function to calculate array factor with weighting (apodization).
    
    DEPRECATED: Use ArrayModel.compute_af() with weights parameter instead.
    
    Args:
        num_elements: Number of array elements.
        spacing: Element spacing in wavelengths.
        wavelength: Operating wavelength.
        steering_angle_rad: Steering angle in radians.
        theta_rad: Observation angle in radians.
        amplitude: Element amplitude.
        weights: Apodization weights (one per element).
    
    Returns:
        Normalized magnitude of weighted array factor.
    """
    k = wave_number(wavelength)
    real = 0
    imag = 0
    total_weight = 0
    
    for n in range(num_elements):
        w = weights[n] if n < len(weights) else 1.0
        total_weight += w
        steering_phase = phase_shift(k, n, spacing, steering_angle_rad)
        observe_phase = phase_shift(k, n, spacing, theta_rad)
        phase = observe_phase - steering_phase
        real += amplitude * w * math.cos(phase)
        imag += amplitude * w * math.sin(phase)
    
    return math.sqrt(real * real + imag * imag) / total_weight
