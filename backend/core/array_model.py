"""Linear antenna array model"""
from dataclasses import dataclass
from typing import List


@dataclass
class ArrayElement:
    index: int
    x: float
    y: float
    amplitude: float
    phase: float


def create_linear_array(
    num_elements: int,
    spacing: float,
    amplitude: float = 1.0
) -> List[ArrayElement]:
    """Create a linear antenna array"""
    elements = []
    offset = ((num_elements - 1) * spacing) / 2
    
    for n in range(num_elements):
        elements.append(
            ArrayElement(
                index=n,
                x=n * spacing - offset,
                y=0,
                amplitude=amplitude,
                phase=0
            )
        )
    
    return elements
