# Beamforming Simulator (React + FastAPI)

A full 2D beamforming simulator with three applications:

- 5G multi-tower connectivity simulator
- Ultrasound A/B/Doppler simulator on a Shepp-Logan style phantom
- 360-degree phased-array radar simulator

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: FastAPI + NumPy

## Project Structure

- `frontend/` React application
- `backend/` FastAPI service and simulation engines

## Run Backend

```bash
cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend default URL: <http://localhost:5173>
Backend default URL: <http://localhost:8000>

## Notes

- Beamforming controls include at least seven core parameters, including windowing/apodization and SNR (0-1000).
- The frontend uses request cancellation and debounced updates for smooth real-time interaction.
