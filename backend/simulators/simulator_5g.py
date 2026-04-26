"""5G Network simulator with tower/user management - OOP implementation"""

import math
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, field

from ..core.beamforming_engine import BeamformingEngine, BeamformingResult
from ..core.array_model import ArrayModel
from ..core.signal_model import SignalModel
from ..core.noise_model import NoiseModel
from ..core.window_functions import WindowFunction


@dataclass
class Tower:
    """5G tower with beamforming capabilities.
    
    Attributes:
        id: Unique tower identifier.
        x: X position in meters.
        y: Y position in meters.
        steering_angle_deg: Current main beam steering angle in degrees.
        beamwidth_deg: Main lobe beamwidth in degrees.
        max_gain_db: Peak antenna gain in dB.
        coverage_radius_m: Visible coverage radius in meters (cell radius).
        num_elements: Per-tower element count override (None = use simulator default).
        frequency: Per-tower frequency override in Hz (None = use simulator default).
    """
    id: int
    x: float
    y: float
    steering_angle_deg: float = 0.0
    beamwidth_deg: float = 30.0
    max_gain_db: float = 20.0
    coverage_radius_m: float = 5.0
    # Per-tower overrides (None = use simulator defaults)
    num_elements: Optional[int] = None
    spacing: Optional[float] = None           # in wavelengths (d/λ)
    frequency: Optional[float] = None         # Hz
    amplitude: Optional[float] = None         # linear
    snr_db: Optional[float] = None            # dB
    window_type: Optional[str] = None         # e.g. "rectangular", "hamming"
    apodization_enabled: Optional[bool] = None


@dataclass
class User:
    """Mobile user receiving 5G signal.
    
    Attributes:
        id: Unique user identifier.
        x: X position in meters.
        y: Y position in meters.
        signal_strength: Received signal strength (linear).
        snr_db: Signal-to-noise ratio in dB.
        connected_tower_id: Tower this user is currently connected to (None = unconnected).
    """
    id: int
    x: float
    y: float
    signal_strength: float = 0.0
    snr_db: float = 0.0
    connected_tower_id: Optional[int] = None


@dataclass
class TowerConnectivityInfo:
    """Connectivity information between tower and user.
    
    Attributes:
        tower_id: Source tower ID.
        user_id: Target user ID.
        distance_m: Distance between tower and user in meters.
        angle_to_user_deg: Direction to user from tower in degrees.
        angle_offset_from_beam_deg: Offset from tower beam direction in degrees.
        gain_at_user: Beam gain at user location (0-1).
        path_loss_db: Free-space path loss in dB.
        signal_strength: Received signal strength (linear).
    """
    tower_id: int
    user_id: int
    distance_m: float
    angle_to_user_deg: float
    angle_offset_from_beam_deg: float
    gain_at_user: float
    path_loss_db: float
    signal_strength: float


@dataclass
class FiveGResult:
    """Complete result of 5G simulation.
    
    Attributes:
        towers: List of simulated towers with final state.
        users: List of users with signal strength.
        connectivity_map: Tower-user connectivity details.
        network_coverage: Network-wide coverage metrics.
        beam_patterns: Beam patterns for each tower.
    """
    towers: List[Tower]
    users: List[User]
    connectivity_map: List[TowerConnectivityInfo]
    network_coverage: Dict
    beam_patterns: List[Dict]


class Simulator5G(BeamformingEngine):
    """5G network simulator with tower/user management and beam steering.
    
    This class extends BeamformingEngine to simulate a 5G network with multiple
    towers and mobile users. Each tower independently steers its beam to maximize
    coverage or can auto-steer toward nearest user.
    
    Attributes:
        towers: List of Tower instances in the network.
        users: List of User instances in the coverage area.
        auto_steer_enabled: Whether towers auto-steer toward nearest user.
        speed_of_light: Propagation speed in m/s (default: 3e8).
    """
    
    # Path loss exponent for free-space propagation
    PATH_LOSS_EXPONENT = 2.0
    
    # Reference distance (1 meter) for path loss calculation
    REFERENCE_DISTANCE = 1.0

    # Hysteresis margin (dB): a new tower must be this much stronger
    # than the current one before triggering a handoff.
    HANDOFF_MARGIN_DB = 3.0
    
    def __init__(
        self,
        num_elements: int = 16,
        spacing: float = 0.5,
        frequency: float = 28e9,
        snr_db: float = 30,
        window_type: str = "hamming",
        amplitude: float = 1.0,
        speed_of_light: float = 3e8
    ):
        """Initialize 5G simulator with array and propagation parameters.
        
        Args:
            num_elements: Number of antenna elements (default: 16).
            spacing: Element spacing in wavelengths (default: 0.5).
            frequency: Operating frequency in Hz (default: 28 GHz).
            snr_db: Signal-to-noise ratio in dB (default: 30).
            window_type: Apodization window type (default: "hamming").
            amplitude: Reference signal amplitude (default: 1.0).
            speed_of_light: Speed of propagation (default: 3e8 m/s).
        
        Raises:
            ValueError: If parameters invalid.
        """
        # Initialize parent BeamformingEngine
        array = ArrayModel(num_elements, spacing, frequency, amplitude, speed_of_light)
        signal = SignalModel(frequency, speed_of_light, amplitude)
        noise = NoiseModel(snr_db)
        window = WindowFunction(window_type, num_elements)
        
        super().__init__(array, signal, noise, window)
        
        # 5G-specific state
        self.towers: List[Tower] = []
        self.users: List[User] = []
        self.auto_steer_enabled: bool = False
        self.speed_of_light: float = speed_of_light
        
        # Initialize with default network
        self._setup_default_network()
    
    def _setup_default_network(self) -> None:
        """Set up default 5G network with 3 towers and 2 users."""
        # 3 towers arranged in triangle
        self.add_tower(tower_id=1, x=-3.0, y=0.0)
        self.add_tower(tower_id=2, x=0.0, y=0.0)
        self.add_tower(tower_id=3, x=3.0, y=0.0)
        
        # 2 users in coverage area
        self.add_user(user_id=101, x=1.0, y=3.0)
        self.add_user(user_id=102, x=-2.0, y=4.0)
    
    def add_tower(
        self,
        tower_id: int,
        x: float,
        y: float,
        steering_angle_deg: float = 0.0
    ) -> Tower:
        """Add a tower to the network.
        
        Args:
            tower_id: Unique identifier for this tower.
            x: X position in meters.
            y: Y position in meters.
            steering_angle_deg: Initial steering angle in degrees (default: 0).
        
        Returns:
            The created Tower instance.
        
        Raises:
            ValueError: If tower_id already exists.
        """
        # Check for duplicate ID
        if any(t.id == tower_id for t in self.towers):
            raise ValueError(f"Tower {tower_id} already exists")
        
        tower = Tower(
            id=tower_id,
            x=x,
            y=y,
            steering_angle_deg=steering_angle_deg
        )
        self.towers.append(tower)
        return tower
    
    def add_user(
        self,
        user_id: int,
        x: float,
        y: float
    ) -> User:
        """Add a user to the coverage area.
        
        Args:
            user_id: Unique identifier for this user.
            x: X position in meters.
            y: Y position in meters.
        
        Returns:
            The created User instance.
        
        Raises:
            ValueError: If user_id already exists.
        """
        # Check for duplicate ID
        if any(u.id == user_id for u in self.users):
            raise ValueError(f"User {user_id} already exists")
        
        user = User(id=user_id, x=x, y=y)
        self.users.append(user)
        return user
    
    def remove_tower(self, tower_id: int) -> bool:
        """Remove a tower from the network.
        
        Args:
            tower_id: ID of tower to remove.
        
        Returns:
            True if tower was found and removed, False otherwise.
        """
        for i, tower in enumerate(self.towers):
            if tower.id == tower_id:
                self.towers.pop(i)
                return True
        return False
    
    def remove_user(self, user_id: int) -> bool:
        """Remove a user from the coverage area.
        
        Args:
            user_id: ID of user to remove.
        
        Returns:
            True if user was found and removed, False otherwise.
        """
        for i, user in enumerate(self.users):
            if user.id == user_id:
                self.users.pop(i)
                return True
        return False
    
    def _compute_path_loss(self, distance_m: float) -> float:
        """Compute free-space path loss at given distance.
        
        Path Loss = 20*log10(4*π*d/λ) where d is distance, λ is wavelength.
        
        Args:
            distance_m: Distance in meters.
        
        Returns:
            Path loss in dB.
        """
        if distance_m <= 0:
            return 0.0
        
        wavelength = self.signal.wavelength
        path_loss = 20 * math.log10((4 * math.pi * distance_m) / wavelength)
        return path_loss
    
    def _get_beam_gain_at_angle(
        self,
        angle_deg: float,
        steering_angle_deg: float
    ) -> float:
        """Get beam gain at specific angle relative to steering direction.
        
        Args:
            angle_deg: Observation angle in degrees.
            steering_angle_deg: Main beam steering angle in degrees.
        
        Returns:
            Normalized beam gain (0 to 1).
        """
        # Compute array factor at this angle with current steering
        af_value = self.array.compute_af(
            angles_deg=[angle_deg],
            steering_angle_deg=steering_angle_deg,
            weights=self.window.get_weights()
        )[0]
        return af_value

    @staticmethod
    def _normalized_sinc(x: float) -> float:
        """Compute normalized sinc = sin(x)/x with sinc(0)=1."""
        if abs(x) < 1e-12:
            return 1.0
        return math.sin(x) / x

    def _compute_split_signal(
        self,
        n_allocated: int,
        n_total: int,
        distance_m: float,
        theta_deg: float,
        spacing_over_lambda: float,
        wavelength_m: float,
        amplitude: float,
    ) -> float:
        """Compute split-array signal using distance-decay and sinc beam term.

        Formula:
            signal = amplitude * (N_allocated/N_total)
                     * |sinc(N_allocated * pi * spacing * sin(theta) / lambda)|
                     / distance^2

        Notes:
            - spacing_over_lambda corresponds to d/λ.
            - theta is the offset from the allocated sub-beam steering angle.
        """
        n_alloc = max(1, int(n_allocated))
        n_tot = max(1, int(n_total))
        d = max(distance_m, 1e-3)
        theta_rad = math.radians(theta_deg)
        x = n_alloc * math.pi * float(spacing_over_lambda) * math.sin(theta_rad)
        beam_term = abs(self._normalized_sinc(x))
        return float(amplitude) * (n_alloc / n_tot) * beam_term / (d * d)

    def _tower_effective_params(self, tower: Tower) -> Dict[str, float | str | bool | int]:
        """Resolve effective per-tower parameters with simulator defaults."""
        n_elem = tower.num_elements if tower.num_elements is not None else self.array.num_elements
        spacing = tower.spacing if tower.spacing is not None else self.array.spacing
        freq = tower.frequency if tower.frequency is not None else self.signal.frequency
        amp = tower.amplitude if tower.amplitude is not None else self.signal.amplitude
        snr = tower.snr_db if tower.snr_db is not None else self.noise.snr_db
        win = tower.window_type if tower.window_type is not None else self.window.window_type
        apod = tower.apodization_enabled if tower.apodization_enabled is not None else False
        return {
            "num_elements": int(n_elem),
            "spacing": float(spacing),
            "frequency": float(freq),
            "amplitude": float(amp),
            "snr_db": float(snr),
            "window_type": str(win),
            "apodization_enabled": bool(apod),
        }

    @staticmethod
    def _wrap_angle_deg(angle_deg: float) -> float:
        """Normalize angle to [-180, 180] degrees."""
        while angle_deg > 180:
            angle_deg -= 360
        while angle_deg < -180:
            angle_deg += 360
        return angle_deg
    
    def auto_update_tower_params(self) -> None:
        """Auto-steer all towers toward their nearest user.
        
        Each tower computes angle to all users and steers toward nearest.
        """
        for tower in self.towers:
            if not self.users:
                tower.steering_angle_deg = 0
                continue
            
            # Find nearest user
            min_distance = float('inf')
            best_angle = 0
            
            for user in self.users:
                dx = user.x - tower.x
                dy = user.y - tower.y
                distance = math.sqrt(dx * dx + dy * dy)
                
                if distance < min_distance:
                    min_distance = distance
                    # Compute steering angle to user
                    best_angle = math.atan2(dx, dy) * 180 / math.pi
            
            tower.steering_angle_deg = best_angle
    
    def compute_element_allocations(
        self,
        user_connections: Dict[int, Optional[int]]
    ) -> Dict[int, List[Dict]]:
        """Split each tower's elements among its connected users using sector-based logic.

        Each tower has 3 sectors: Alpha (0-120°), Beta (120-240°), Gamma (240-360°).
        Each sector is allocated exactly N/3 elements. If multiple users are in
        the same sector, that sector's elements are split among them.

        Args:
            user_connections: {user_id: tower_id} mapping.

        Returns:
            {tower_id: [
                {
                    "user_id":       int,
                    "num_elements":  int,
                    "element_start": int,
                    "element_end":   int,
                    "angle_deg":     float,
                    "fraction":      float,
                    "sector":        str,   # "Alpha", "Beta", or "Gamma"
                }
            ]}
        """
        # Group connected users per tower and per sector
        tower_to_sector_users: Dict[int, Dict[str, List[int]]] = {
            t.id: {"Alpha": [], "Beta": [], "Gamma": []} for t in self.towers
        }
        
        user_by_id = {u.id: u for u in self.users}
        tower_by_id = {t.id: t for t in self.towers}

        for uid, tid in user_connections.items():
            if tid is not None and tid in tower_to_sector_users:
                user = user_by_id.get(uid)
                tower = tower_by_id.get(tid)
                if not user or not tower:
                    continue
                
                # Compute angle 0-360
                dx, dy = user.x - tower.x, user.y - tower.y
                angle_deg = (math.atan2(dx, dy) * 180 / math.pi + 360) % 360
                
                if 0 <= angle_deg < 120:
                    sector = "Alpha"
                elif 120 <= angle_deg < 240:
                    sector = "Beta"
                else:
                    sector = "Gamma"
                
                tower_to_sector_users[tid][sector].append(uid)

        allocations: Dict[int, List[Dict]] = {}
        for tower in self.towers:
            n_total = tower.num_elements if tower.num_elements is not None else self.array.num_elements
            # Distribute elements evenly, remainder goes to Alpha then Beta
            base_n = n_total // 3
            rem = n_total % 3
            sector_sizes = {
                "Alpha": base_n + (1 if rem >= 1 else 0),
                "Beta":  base_n + (1 if rem >= 2 else 0),
                "Gamma": base_n
            }
            sector_offsets = {
                "Alpha": 0,
                "Beta":  sector_sizes["Alpha"],
                "Gamma": sector_sizes["Alpha"] + sector_sizes["Beta"]
            }

            tower_entries: List[Dict] = []
            for sector in ["Alpha", "Beta", "Gamma"]:
                uids = tower_to_sector_users[tower.id][sector]
                if not uids:
                    continue
                
                n_sec = sector_sizes[sector]
                n_users = len(uids)
                base_share = n_sec // n_users
                remainder   = n_sec - base_share * n_users
                
                cursor = sector_offsets[sector]
                for i, uid in enumerate(uids):
                    share = base_share + (1 if i == n_users - 1 else 0) * remainder
                    share = max(1, share)
                    
                    user = user_by_id.get(uid)
                    angle_deg = 0.0
                    if user:
                        dx, dy = user.x - tower.x, user.y - tower.y
                        angle_deg = math.atan2(dx, dy) * 180 / math.pi

                    tower_entries.append({
                        "user_id":       uid,
                        "num_elements":  share,
                        "element_start": cursor,
                        "element_end":   cursor + share,
                        "angle_deg":     angle_deg,
                        "fraction":      share / max(1, n_total),
                        "sector":        sector
                    })
                    cursor += share
            
            allocations[tower.id] = tower_entries

        return allocations


    def compute_tower_connectivity(self, element_allocations: Dict[int, List[Dict]] = None) -> List[TowerConnectivityInfo]:
        """Compute connectivity between all towers and users.
        
        Args:
           element_allocations: Optional mapping of tower ID to its element allocations.
                                Used to compute multi-steered gain.
        Returns:
            List of TowerConnectivityInfo for each tower-user pair.
        """
        connectivity = []
        if element_allocations is None:
            element_allocations = {}
        
        for tower in self.towers:
            allocs = element_allocations.get(tower.id, [])
            eff = self._tower_effective_params(tower)
            freq = float(eff["frequency"])
            wavelength_m = self.speed_of_light / max(1.0, freq)
            spacing_over_lambda = float(eff["spacing"])
            amplitude = float(eff["amplitude"])
            
            for user in self.users:
                # Distance and angle
                dx = user.x - tower.x
                dy = user.y - tower.y
                distance = math.sqrt(dx * dx + dy * dy)
                
                # Angle to user from tower
                if distance > 0:
                    angle_to_user = math.atan2(dx, dy) * 180 / math.pi
                else:
                    angle_to_user = 0
                
                # Angle offset from nominal beam direction
                angle_offset = self._wrap_angle_deg(angle_to_user - tower.steering_angle_deg)

                n_total = tower.num_elements if tower.num_elements is not None else self.array.num_elements
                alloc_for_user = next((a for a in allocs if a.get("user_id") == user.id), None)

                if alloc_for_user is not None:
                    theta_offset = self._wrap_angle_deg(angle_to_user - float(alloc_for_user.get("angle_deg", 0.0)))
                    signal_strength = self._compute_split_signal(
                        n_allocated=int(alloc_for_user.get("num_elements", 1)),
                        n_total=n_total,
                        distance_m=distance,
                        theta_deg=theta_offset,
                        spacing_over_lambda=spacing_over_lambda,
                        wavelength_m=wavelength_m,
                        amplitude=amplitude,
                    )
                    gain = abs(self._normalized_sinc(
                        int(alloc_for_user.get("num_elements", 1))
                        * math.pi
                        * spacing_over_lambda
                        * math.sin(math.radians(theta_offset))
                    ))
                else:
                    # Unallocated users see leakage from nominal tower beam plus distance decay.
                    gain = self._get_beam_gain_at_angle(angle_to_user, tower.steering_angle_deg)
                    signal_strength = amplitude * gain / max(distance * distance, 1e-6)

                path_loss_db = self._compute_path_loss(distance)
                
                info = TowerConnectivityInfo(
                    tower_id=tower.id,
                    user_id=user.id,
                    distance_m=distance,
                    angle_to_user_deg=angle_to_user,
                    angle_offset_from_beam_deg=angle_offset,
                    gain_at_user=gain,
                    path_loss_db=path_loss_db,
                    signal_strength=signal_strength
                )
                connectivity.append(info)
        
        return connectivity
    
    def get_element_steering(self, tower: Tower, allocations: List[Dict]) -> List[float]:
        """Get per-element steering angles for a tower given element allocations."""
        n_elem = tower.num_elements if tower.num_elements is not None else self.array.num_elements
        steering = [tower.steering_angle_deg] * n_elem
        for alloc in allocations:
            for idx in range(alloc["element_start"], alloc["element_end"]):
                if idx < n_elem:
                    steering[idx] = alloc["angle_deg"]
        return steering

    def compute_user_connections(
        self,
        current_connections: Optional[Dict[int, int]] = None
    ) -> Dict[int, Optional[int]]:
        """Determine which tower each user connects to (one tower per user).

        Uses ideal path loss (omni tracking) to avoid dropping users due to 
        momentary misaligned narrow beams. Applies hysteresis to prevent ping-pong.

        Args:
            current_connections: Optional map of {user_id: tower_id} from the
                previous simulation step.  Pass None on the first call.

        Returns:
            Dict mapping user_id -> tower_id (or None if no tower in range).
        """
        # Build per-user signal map using optimal 1.0 gain
        signal_map: Dict[int, Dict[int, float]] = {u.id: {} for u in self.users}

        for tower in self.towers:
            for user in self.users:
                dx = user.x - tower.x
                dy = user.y - tower.y
                distance = math.sqrt(dx * dx + dy * dy)
                if distance > tower.coverage_radius_m:
                    # Out of visible coverage area: tower is not a valid serving candidate.
                    continue
                path_loss_db = self._compute_path_loss(distance)
                
                # Ideal tracking gain = 1.0
                signal = self.signal.amplitude / (10 ** (path_loss_db / 20))
                signal_map[user.id][tower.id] = signal

        connections: Dict[int, Optional[int]] = {}

        for user in self.users:
            sigs = signal_map.get(user.id, {})
            if not sigs:
                connections[user.id] = None
                continue

            best_tower_id = max(sigs, key=lambda tid: sigs[tid])
            best_signal   = sigs[best_tower_id]

            # Apply hysteresis if we were already connected somewhere
            prev_tid = (current_connections or {}).get(user.id)
            if prev_tid is not None and prev_tid in sigs:
                prev_signal = sigs[prev_tid]
                margin_ratio = 10 ** (self.HANDOFF_MARGIN_DB / 20)  # linear
                if best_signal < prev_signal * margin_ratio:
                    # Not strong enough to trigger handoff — stay put
                    best_tower_id = prev_tid

            connections[user.id] = best_tower_id

        return connections

    def update_user_signal_strength(self, element_allocations: Dict[int, List[Dict]] = None) -> None:
        """Update signal strength for each user based on all towers.
        
        Each user receives signal from all towers; total is sum of all contributions.
        Computes composite gain if element allocations exist.
        """
        if element_allocations is None:
            element_allocations = {}
            
        for user in self.users:
            total_signal = 0.0
            
            for tower in self.towers:
                eff = self._tower_effective_params(tower)
                freq = float(eff["frequency"])
                wavelength_m = self.speed_of_light / max(1.0, freq)
                spacing_over_lambda = float(eff["spacing"])
                amplitude = float(eff["amplitude"])

                dx = user.x - tower.x
                dy = user.y - tower.y
                distance = math.sqrt(dx * dx + dy * dy)
                
                if distance > 0:
                    angle_to_user = math.atan2(dx, dy) * 180 / math.pi
                else:
                    angle_to_user = 0
                
                allocs = element_allocations.get(tower.id, [])
                n_total = tower.num_elements if tower.num_elements is not None else self.array.num_elements
                alloc_for_user = next((a for a in allocs if a.get("user_id") == user.id), None)

                if alloc_for_user is not None:
                    theta_offset = self._wrap_angle_deg(angle_to_user - float(alloc_for_user.get("angle_deg", 0.0)))
                    signal = self._compute_split_signal(
                        n_allocated=int(alloc_for_user.get("num_elements", 1)),
                        n_total=n_total,
                        distance_m=distance,
                        theta_deg=theta_offset,
                        spacing_over_lambda=spacing_over_lambda,
                        wavelength_m=wavelength_m,
                        amplitude=amplitude,
                    )
                else:
                    gain = self._get_beam_gain_at_angle(angle_to_user, tower.steering_angle_deg)
                    signal = amplitude * gain / max(distance * distance, 1e-6)
                total_signal += signal
            
            user.signal_strength = total_signal
            user.snr_db = self.noise.snr_db
    
    def run(
        self,
        auto_steer: bool = True,
        enable_noise: bool = False,
        grid_size: int = 80,
        current_connections: Optional[Dict[int, int]] = None
    ) -> FiveGResult:
        """Execute 5G network simulation.
        
        Args:
            auto_steer: Whether to auto-steer towers toward nearest user (default: True).
            enable_noise: Whether to add noise to simulations (default: False).
            grid_size: Grid size for beam pattern computation (default: 80).
            current_connections: Previous {user_id: tower_id} map for handoff hysteresis.
        
        Returns:
            FiveGResult with towers, users, connectivity, and beam patterns.
        """
        # 1. Update noise settings
        if enable_noise:
            self.noise.enable_noise()
        else:
            self.noise.disable_noise()

        # 2. Determine which single tower each user is connected to (ideal path loss hysteresis)
        user_connections = self.compute_user_connections(current_connections)
        for user in self.users:
            user.connected_tower_id = user_connections.get(user.id)

        # 3. Compute element allocations (split per shared-tower users)
        element_allocations = self.compute_element_allocations(user_connections)
        
        # 4. Auto-steer nominal steering angle if enabled
        if auto_steer:
            self.auto_update_tower_params()
        
        # 5. Update signal strength for all users using true element allocations
        self.update_user_signal_strength(element_allocations)
        
        # 6. Compute full connectivity map
        connectivity = self.compute_tower_connectivity(element_allocations)

        # Generate beam patterns for each tower
        beam_patterns = []
        default_array  = self.array
        default_freq   = self.signal.frequency
        default_window = self.window

        for tower in self.towers:
            eff = self._tower_effective_params(tower)
            n_elem = int(eff["num_elements"])
            freq   = float(eff["frequency"])
            spacing = float(eff["spacing"])
            amp     = float(eff["amplitude"])
            win     = str(eff["window_type"])
            apod    = bool(eff["apodization_enabled"])

            overriding = (
                n_elem != default_array.num_elements
                or abs(freq - default_freq) > 1e-9
                or abs(spacing - default_array.spacing) > 1e-12
                or abs(amp - default_array.amplitude) > 1e-12
                or win != default_window.window_type
                or apod != (default_window.window_type != "rectangular")
            )

            if overriding:
                self.array         = ArrayModel(n_elem, default_array.spacing, freq,
                                               amp, self.speed_of_light)
                # spacing override
                self.array.spacing = spacing
                # amplitude & frequency override
                self.signal.frequency = freq
                self.signal.amplitude = amp
                # window override (use rectangular if apodization disabled)
                self.window = WindowFunction(win if apod else "rectangular", n_elem)

            allocs = element_allocations.get(tower.id, [])
            steering_angles = self.get_element_steering(tower, allocs) if allocs else None

            beam_result = self.run_simulation(
                steering_angle_deg=tower.steering_angle_deg,
                enable_noise=enable_noise,
                grid_size=grid_size,
                steering_angles_deg=steering_angles
            )

            if overriding:
                # Restore originals
                self.array            = default_array
                self.signal.frequency = default_freq
                self.signal.amplitude = default_array.amplitude
                self.window           = default_window

            beam_patterns.append({
                "tower_id": tower.id,
                "tower_x": tower.x,
                "tower_y": tower.y,
                "steering_angle_deg": tower.steering_angle_deg,
                "num_elements": n_elem,
                "frequency": freq,
                "element_allocations": element_allocations.get(tower.id, []),
                "angles": beam_result.beam_pattern.angles,
                "magnitudes": beam_result.beam_pattern.magnitudes,
                "magnitudes_db": beam_result.beam_pattern.magnitudes_db,
                "metrics": {
                    "beamwidth_deg": beam_result.metrics.beamwidth_deg,
                    "sll_db": beam_result.metrics.sll_db,
                    "main_lobe_angle_deg": beam_result.metrics.main_lobe_angle_deg,
                    "directivity_db": beam_result.metrics.directivity_db,
                    "gain_peak": beam_result.metrics.gain_peak
                }
            })

        
        # Compute network coverage metrics
        total_coverage = sum(u.signal_strength for u in self.users) if self.users else 0
        avg_coverage = total_coverage / len(self.users) if self.users else 0
        
        network_coverage = {
            "num_towers": len(self.towers),
            "num_users": len(self.users),
            "total_signal": total_coverage,
            "average_signal": avg_coverage,
            "max_signal": max((u.signal_strength for u in self.users), default=0),
            "min_signal": min((u.signal_strength for u in self.users), default=0)
        }
        
        # Coverage radius is a Tower attribute (already set)
        return FiveGResult(
            towers=self.towers.copy(),
            users=self.users.copy(),
            connectivity_map=connectivity,
            network_coverage=network_coverage,
            beam_patterns=beam_patterns
        )
    
    def get_coverage_map(self, num_samples: int = 50) -> Dict:
        """Generate 2D coverage map showing signal strength across area.
        
        Args:
            num_samples: Grid resolution (num_samples x num_samples).
        
        Returns:
            Dictionary with grid coordinates and signal strength values.
        """
        extent = 5.0
        coverage_grid = []
        x_range = []
        y_range = []
        
        for yi in range(num_samples):
            y = (extent * yi) / (num_samples - 1)
            y_range.append(y)
            row = []
            
            for xi in range(num_samples):
                x = -extent + (2 * extent * xi) / (num_samples - 1)
                if yi == 0:
                    x_range.append(x)
                
                # Sum signal from all towers
                total_signal = 0.0
                for tower in self.towers:
                    dx = x - tower.x
                    dy = y - tower.y
                    distance = math.sqrt(dx * dx + dy * dy)
                    
                    if distance > 0:
                        angle = math.atan2(dx, dy) * 180 / math.pi
                        gain = self._get_beam_gain_at_angle(angle, tower.steering_angle_deg)
                        path_loss_db = self._compute_path_loss(distance)
                        signal = (gain * self.signal.amplitude) / (10 ** (path_loss_db / 20))
                        total_signal += signal
                
                row.append(total_signal)
            
            coverage_grid.append(row)
        
        return {
            "x_range": x_range,
            "y_range": y_range,
            "coverage": coverage_grid,
            "extent": extent
        }
