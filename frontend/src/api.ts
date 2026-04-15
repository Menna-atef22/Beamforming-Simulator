import type {
  BeamformingRequest,
  BeamformingResponse,
  FiveGRequest,
  FiveGResponse,
  PhantomResponse,
  RadarRequest,
  RadarResponse,
  UltrasoundRequest,
  UltrasoundResponse,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api'

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Request failed: ${res.status}`)
  }

  return (await res.json()) as T
}

export function simulateBeamforming(
  payload: BeamformingRequest,
  signal?: AbortSignal,
): Promise<BeamformingResponse> {
  return fetchJson<BeamformingResponse>('/beamforming/field', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function simulateFiveg(
  payload: FiveGRequest,
  signal?: AbortSignal,
): Promise<FiveGResponse> {
  return fetchJson<FiveGResponse>('/fiveg/simulate', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function getUltrasoundPhantom(signal?: AbortSignal): Promise<PhantomResponse> {
  return fetchJson<PhantomResponse>('/ultrasound/phantom', { signal })
}

export function simulateUltrasound(
  payload: UltrasoundRequest,
  signal?: AbortSignal,
): Promise<UltrasoundResponse> {
  return fetchJson<UltrasoundResponse>('/ultrasound/simulate', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function simulateRadar(
  payload: RadarRequest,
  signal?: AbortSignal,
): Promise<RadarResponse> {
  return fetchJson<RadarResponse>('/radar/simulate', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}
