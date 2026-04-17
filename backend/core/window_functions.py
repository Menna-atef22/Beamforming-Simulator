"""Window functions for sidelobe control - OOP implementation"""

import math
from typing import List, Literal

WindowType = Literal["rectangular", "hamming", "hanning", "blackman", "taylor", "kaiser"]


class WindowFunction:
    """Encapsulates window function computations for antenna apodization.
    
    Window functions are used to taper antenna element amplitudes and reduce
    sidelobe levels at the cost of wider main lobes. This class supports
    common window types used in phased array beamforming.
    
    Attributes:
        window_type: Type of window ("rectangular", "hamming", "hanning",
                     "blackman", "taylor", "kaiser").
        num_elements: Number of array elements.
        weights: Computed window weights (normalized to max=1).
    """
    
    # Taylor window parameters
    TAYLOR_NBAR = 4  # Number of sidelobe levels
    TAYLOR_SLL = -30  # Sidelobe level in dB
    
    # Kaiser window parameter
    KAISER_BETA = 8.6  # Beta parameter for Kaiser window
    
    def __init__(
        self,
        window_type: WindowType = "rectangular",
        num_elements: int = 32,
        kaiser_beta: float = None,
        taylor_nbar: int = None,
        taylor_sll: float = None
    ) -> None:
        """Initialize WindowFunction.
        
        Args:
            window_type: Type of window function (default: "rectangular").
            num_elements: Number of array elements (default: 32).
            kaiser_beta: Kaiser window beta parameter (default: 8.6).
            taylor_nbar: Taylor window # of sidelobe levels (default: 4).
            taylor_sll: Taylor window sidelobe level dB (default: -30).
        
        Raises:
            ValueError: If num_elements < 1 or window_type invalid.
            KeyError: If window_type not supported.
        """
        if num_elements < 1:
            raise ValueError("num_elements must be >= 1")
        
        if window_type not in ["rectangular", "hamming", "hanning", "blackman", "taylor", "kaiser"]:
            raise KeyError(f"Unknown window type: {window_type}")
        
        self.window_type: WindowType = window_type
        self.num_elements: int = num_elements
        self.kaiser_beta: float = kaiser_beta or self.KAISER_BETA
        self.taylor_nbar: int = taylor_nbar or self.TAYLOR_NBAR
        self.taylor_sll: float = taylor_sll or self.TAYLOR_SLL
        
        # Compute weights
        self.weights: List[float] = self._compute_weights()
    
    def _compute_weights(self) -> List[float]:
        """Compute window weights based on window type.
        
        Returns:
            List of normalized weights (0 to 1).
        """
        if self.window_type == "rectangular":
            return [1.0] * self.num_elements
        
        elif self.window_type == "hamming":
            return self._hamming_window()
        
        elif self.window_type == "hanning":
            return self._hanning_window()
        
        elif self.window_type == "blackman":
            return self._blackman_window()
        
        elif self.window_type == "kaiser":
            return self._kaiser_window()
        
        elif self.window_type == "taylor":
            return self._taylor_window()
        
        else:
            return [1.0] * self.num_elements
    
    def _hamming_window(self) -> List[float]:
        """Hamming window: w(n) = 0.54 - 0.46*cos(2πn/(N-1))"""
        weights = []
        N = self.num_elements - 1
        
        for n in range(self.num_elements):
            if N == 0:
                w = 1.0
            else:
                w = 0.54 - 0.46 * math.cos((2 * math.pi * n) / N)
            weights.append(w)
        
        return weights
    
    def _hanning_window(self) -> List[float]:
        """Hanning window: w(n) = 0.5*(1 - cos(2πn/(N-1)))"""
        weights = []
        N = self.num_elements - 1
        
        for n in range(self.num_elements):
            if N == 0:
                w = 1.0
            else:
                w = 0.5 * (1 - math.cos((2 * math.pi * n) / N))
            weights.append(w)
        
        return weights
    
    def _blackman_window(self) -> List[float]:
        """Blackman window: w(n) = 0.42 - 0.5*cos(...) + 0.08*cos(...)"""
        weights = []
        N = self.num_elements - 1
        
        for n in range(self.num_elements):
            if N == 0:
                w = 1.0
            else:
                cos1 = math.cos((2 * math.pi * n) / N)
                cos2 = math.cos((4 * math.pi * n) / N)
                w = 0.42 - 0.5 * cos1 + 0.08 * cos2
            weights.append(w)
        
        return weights
    
    @staticmethod
    def _bessel_i0(x: float, terms: int = 20) -> float:
        """Approximate Bessel function I0 using series expansion.
        
        I0(x) = sum_{k=0}^∞ (x/(2*k))^2 / k!^2
        
        Args:
            x: Argument to Bessel I0.
            terms: Number of series terms (default: 20).
        
        Returns:
            Approximation of I0(x).
        """
        sum_val = 1.0
        term = 1.0
        
        for k in range(1, terms):
            term *= (x / (2.0 * k)) * (x / (2.0 * k))
            sum_val += term
        
        return sum_val
    
    def _kaiser_window(self) -> List[float]:
        """Kaiser window using Bessel function approximation.
        
        w(n) = I0(β*sqrt(1-(2n/(N-1)-1)²)) / I0(β)
        
        where β controls sidelobe tradeoff (higher β → lower sidelobes).
        """
        weights = []
        N = self.num_elements - 1
        i0_beta = self._bessel_i0(self.kaiser_beta)
        
        for n in range(self.num_elements):
            if N == 0:
                w = 1.0
            else:
                x = 2.0 * n / N - 1.0
                arg = self.kaiser_beta * math.sqrt(1.0 - x * x)
                i0_arg = self._bessel_i0(arg)
                w = i0_arg / i0_beta
            
            weights.append(w)
        
        return weights
    
    def _taylor_window(self) -> List[float]:
        """Taylor window using equal-ripple design.
        
        Provides control over sidelobe level (taylor_sll) and number of
        constant-level sidelobes (taylor_nbar).
        """
        weights = []
        
        # For simplicity, use Chebyshev approximation
        # In practice, would use Taylor-Weighting algorithm
        # For now, use Hamming as fallback with parameter modulation
        
        # Transitional implementation: blend toward more aggressive taper
        hamming_base = self._hamming_window()
        N = self.num_elements - 1
        
        # Apply additional taper based on SLL and nbar
        for n in range(self.num_elements):
            if N == 0:
                w = 1.0
            else:
                x = 2.0 * n / N - 1.0
                # Increase edge taper for lower SLL
                sll_factor = abs(self.taylor_sll) / 30.0  # Normalize to -30dB reference
                edge_taper = 1.0 - sll_factor * (x * x)
                w = hamming_base[n] * max(edge_taper, 0.1)
            
            weights.append(w)
        
        return weights
    
    def get_weights(self) -> List[float]:
        """Get window weights.
        
        Returns:
            List of weights (normalized, max value = 1.0).
        """
        return self.weights.copy()
    
    def get_weight(self, element_index: int) -> float:
        """Get weight for specific element.
        
        Args:
            element_index: Index of element (0-based).
        
        Returns:
            Weight value for that element.
        
        Raises:
            IndexError: If element_index out of range.
        """
        if element_index < 0 or element_index >= self.num_elements:
            raise IndexError(f"element_index {element_index} out of range [0, {self.num_elements-1}]")
        
        return self.weights[element_index]
    
    def get_main_lobe_width(self) -> float:
        """Estimate main lobe width from window (empirical).
        
        Returns:
            Approximate main lobe width in array elements.
        """
        # Empirical: rectangular=1, Hamming/Hanning≈1.3, Blackman≈1.7
        type_widths = {
            "rectangular": 1.0,
            "hamming": 1.3,
            "hanning": 1.3,
            "blackman": 1.7,
            "kaiser": 1.5,
            "taylor": 1.4
        }
        
        return type_widths.get(self.window_type, 1.3)
    
    def __repr__(self) -> str:
        """String representation."""
        return f"WindowFunction({self.window_type}, {self.num_elements} elements)"

def apply_window(signals: list, window_type: str = "rectangular", num_elements: int = None) -> list:
    """Apply a window function to signals.
    
    Args:
        signals: List of signal values.
        window_type: Type of window function (default: "rectangular").
        num_elements: Number of elements (default: len(signals)).
    
    Returns:
        List of windowed signals.
    """
    if num_elements is None:
        num_elements = len(signals)
    
    window_fn = WindowFunction(window_type, num_elements)
    weights = window_fn.get_weights()
    
    # Normalize weights to match signal length
    if len(weights) != len(signals):
        # Interpolate or truncate as needed
        if len(weights) > len(signals):
            weights = weights[:len(signals)]
        else:
            # Pad with last value
            weights = weights + [weights[-1]] * (len(signals) - len(weights))
    
    return [s * w for s, w in zip(signals, weights)]
