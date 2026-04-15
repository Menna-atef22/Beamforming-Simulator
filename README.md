# Beam Weaver - Full Stack Project

A full-stack web application for beamforming simulation and visualization with a **Python FastAPI backend** and **React TypeScript frontend**.

## 📁 New Project Structure

```
beam-weaver/
├── backend/                    # Python FastAPI Backend (Port 5000)
│   ├── core/                   # Core beamforming computation engine
│   ├── api/                    # API routes & schemas
│   ├── simulators/             # 5G, Radar, Ultrasound simulators
│   ├── app.py                  # FastAPI application entry point
│   ├── run_server.py           # Server launcher script
│   ├── requirements.txt        # Python dependencies
│   └── README.md
│
├── frontend/                   # React TypeScript Frontend (Port 8080)
│   ├── src/                    # React source code
│   │   ├── pages/              # Page components
│   │   ├── components/         # Reusable UI components
│   │   ├── hooks/              # Custom React hooks
│   │   ├── types/              # TypeScript definitions
│   │   ├── lib/                # Utilities
│   │   └── test/               # Frontend tests
│   ├── public/                 # Static assets
│   ├── package.json            # Frontend npm dependencies
│   ├── vite.config.ts          # Vite build configuration
│   ├── tsconfig.json           # TypeScript configuration
│   └── [other config files]
│
├── README.md                   # This file
├── PROJECT_README.md           # Detailed project documentation
└── .gitignore
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** (for frontend)
- **Python 3.8+** (for backend)
- **npm** or **yarn** (for frontend)

### Installation

**Backend Setup:**
```bash
cd backend
pip install -r requirements.txt
```

**Frontend Setup:**
```bash
cd frontend
npm install
```

---

## 🏃 Running the Project

### Option 1: Run Both Servers (Development)

**Terminal 1 - Backend:**
```bash
cd backend
python run_server.py
```
Backend runs on: `http://localhost:5000`

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```
Frontend runs on: `http://localhost:8080`

### Option 2: Production Build

**Build Frontend:**
```bash
cd frontend
npm run build
```

**Run Backend (serves frontend):**
```bash
cd backend
python run_server.py
```

---

## 📦 Frontend Commands

From `frontend/` directory:

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm run test         # Run tests once
npm run test:watch   # Run tests in watch mode
```

## 📦 Backend Commands

From `backend/` directory:

```bash
python run_server.py          # Start FastAPI server
python test_backend.py        # Run backend tests
python verify_architecture.py # Verify code structure
```

---

## 🎯 Features

### 5G Beamforming Simulator
- Massive MIMO antenna array simulation
- Beam pattern visualization
- Signal processing and analysis

### Radar Beamforming Simulator
- Radar signal processing
- Beam steering and nulling
- Range/Doppler analysis

### Ultrasound Beamforming Simulator
- Medical ultrasound simulation
- Phased array beamforming
- Synthetic aperture techniques

---

## 🔌 API Endpoints

All endpoints are on `http://localhost:5000/api/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/simulate/5g` | POST | Run 5G simulation |
| `/simulate/radar` | POST | Run Radar simulation |
| `/simulate/ultrasound` | POST | Run Ultrasound simulation |
| `/health` | GET | Health check |

---

## 📚 Documentation

- **Detailed Structure**: [PROJECT_README.md](PROJECT_README.md)
- **Backend Docs**: [backend/README.md](backend/README.md)
- **Frontend Docs**: See `frontend/package.json` scripts

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   React Frontend (8080)                  │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Pages: Simulator5G, SimulatorRadar, etc.         │   │
│  │ Components: BeamPlot, HeatmapView, ControlPanel  │   │
│  │ Hooks: Custom API integration hooks              │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP API
                         ▼
┌─────────────────────────────────────────────────────────┐
│                 FastAPI Backend (5000)                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ API Routes: /api/simulate/5g, /radar, /ultrasound │   │
│  │ Service Layer: Business logic & orchestration     │   │
│  │ Core Engine: Beamforming computations             │   │
│  │ Simulators: 5G, Radar, Ultrasound                 │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 🧪 Testing

**Frontend Tests:**
```bash
cd frontend
npm run test
```

**Backend Tests:**
```bash
cd backend
python -m pytest test_backend.py
```

---

## 🛠️ Development Workflow

### Adding a New Simulator
1. Create `simulator_new.py` in `backend/simulators/`
2. Add API route in `backend/api/routes.py`
3. Create React page in `frontend/src/pages/`
4. Add custom hook in `frontend/src/hooks/`

### Adding UI Components
1. Use ShadCN/UI components from `frontend/src/components/ui/`
2. Create custom components in `frontend/src/components/`
3. Use Tailwind CSS for styling

---

## 🐛 Troubleshooting

### Frontend won't connect to backend
- Ensure backend is running on `http://localhost:5000`
- Check API endpoint URLs in frontend hooks
- Verify CORS configuration

### Backend calculation errors
- Check Python version (3.8+)
- Verify NumPy and dependencies are installed
- Review simulation parameters

### Build/Install failures
- Clear `frontend/node_modules/` and `frontend/dist/`
- Run `npm install` in frontend again
- Check Node.js version compatibility

---

## 📋 Technology Stack

### Frontend
- React 18
- TypeScript
- Vite (build tool)
- Tailwind CSS
- ShadCN/UI components
- Framer Motion
- React Query

### Backend
- FastAPI
- Uvicorn
- NumPy
- Python 3.8+

---

## 📄 License

[Add your license information]

## 👥 Contributors

[Add contributor information]

---

**Last Updated**: April 2026  
**Version**: 2.0.0 (Reorganized Structure)
