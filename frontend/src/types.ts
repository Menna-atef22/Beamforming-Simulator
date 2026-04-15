export type WindowType = 'rectangular' | 'hamming' | 'hann' | 'blackman' | 'tukey'

export interface BeamformingRequest {
  num_elements: number
  element_spacing_m: number
  carrier_frequency_hz: number
  steering_angle_deg: number
  phase_offset_deg: number
  amplitude: number
  aperture_m: number
  sample_points: number
  view_extent_m: number
  window_type: WindowType
  apodization_alpha: number
  snr: number
}

export interface BeamformingResponse {
  x_axis: number[]
  y_axis: number[]
  constructive_map: number[][]
  beam_angles_deg: number[]
  beam_profile_db: number[]
  main_lobe_deg: number
  half_power_bw_deg: number
}

export interface TowerIn {
  id: string
  x: number
  y: number
  power_dbm: number
  carrier_ghz: number
  max_range_m: number
  num_elements: number
}

export interface UserIn {
  id: string
  x: number
  y: number
}

export interface FiveGRequest {
  towers: TowerIn[]
  users: UserIn[]
  snr: number
  noise_floor_dbm?: number
}

export interface LinkResult {
  tower_id: string
  user_id: string
  distance_m: number
  snr_db: number
  quality: number
  connected: boolean
}

export interface TowerAutoParameters {
  id: string
  steering_angle_deg: number
  beam_width_deg: number
  suggested_power_dbm: number
  suggested_num_elements: number
  connected_user_ids: string[]
}

export interface FiveGResponse {
  links: LinkResult[]
  towers: TowerAutoParameters[]
}

export interface PhantomShape {
  id: string
  label: string
  cx: number
  cy: number
  rx: number
  ry: number
  angle_deg: number
  acoustic_impedance_mrayl: number
  attenuation_db_cm_mhz: number
  reflectivity: number
  scatter: number
}

export interface ProbeState {
  surface_angle_deg: number
  beam_direction_deg: number
  frequency_mhz: number
  max_depth_mm: number
}

export interface VesselState {
  x: number
  y: number
  radius: number
  velocity_cm_s: number
  direction_deg: number
}

export interface ScanLine {
  surface_angle_deg: number
  beam_direction_deg: number
}

export interface UltrasoundRequest {
  shapes: PhantomShape[]
  probe: ProbeState
  scan_lines: ScanLine[]
  vessel: VesselState
  snr: number
}

export interface UltrasoundResponse {
  a_mode_depths_mm: number[]
  a_mode_amplitude: number[]
  b_mode_image: number[][]
  doppler_freq_axis_hz: number[]
  doppler_spectrum: number[]
  color_flow_velocity_cm_s: number
  probe_xy: number[]
  intersections: number[][]
}

export interface PhantomResponse {
  shapes: PhantomShape[]
  vessel: VesselState
}

export interface RadarBody {
  id: string
  x: number
  y: number
  size_m: number
  reflectivity: number
}

export interface RadarRequest {
  bodies: RadarBody[]
  current_angle_deg: number
  scan_speed_deg_s: number
  beam_width_deg: number
  delta_time_s: number
  max_range_m: number
  snr: number
}

export interface RadarDetection {
  body_id: string
  range_m: number
  bearing_deg: number
  estimated_size_m: number
  strength: number
}

export interface RadarResponse {
  next_angle_deg: number
  detections: RadarDetection[]
  sweep_points: number[][]
  max_range_m: number
}
