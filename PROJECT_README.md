# Beam Weaver - Full Stack Project

A full-stack web application for beamforming simulation and visualization. This project contains both a Python FastAPI backend for computation and a React TypeScript frontend for visualization.

## 📁 Project Structure

```
beam-weaver/
├── backend/                    # Python FastAPI Backend (Port 5000)
│   ├── core/                   # Core beamforming computation engine
│   │   ├── array_model.py              # Linear antenna array model
│   │   ├── signal_model.py             # Signal propagation calculations
│   │   ├── noise_model.py              # Gaussian noise modeling
│   │   ├── window_functions.py         # Window functions (Hamming, Hanning, etc.)
│   │   ├── interference_map.py         # 2D interference map generation
│   │   ├── beamforming_engine.py       # Main simulation engine
│   │   └── __init__.py
│   │
│   ├── api/                    # API layer
│   │   ├── routes.py                   # API route definitions
│   │   ├── schemas.py                  # Pydantic request/response models
│   │   └── __init__.py
│   │
│   ├── simulators/             # Specialized simulators
│   │   ├── simulator_5g.py             # 5G beamforming simulator
│   │   ├── simulator_radar.py          # Radar beamforming simulator
│   │   ├── simulator_ultrasound.py     # Ultrasound beamforming simulator
│   │   └── __init__.py
│   │
│   ├── app.py                  # FastAPI application entry point
│   ├── run_server.py           # Server launcher script
│   ├── service.py              # Business logic service layer
│   ├── serializers.py          # Data serialization utilities
│   ├── requirements.txt        # Python dependencies
│   └── pyrightconfig.json      # Type checking configuration
│
├── src/                        # React TypeScript Frontend (Port 8080)
│   ├── pages/                  # Page components
│   │   ├── Home.tsx                    # Home/index page
│   │   ├── Simulator5G.tsx             # 5G simulator interface
│   │   ├── SimulatorRadar.tsx          # Radar simulator interface
│   │   ├── SimulatorUltrasound.tsx     # Ultrasound simulator interface
│   │   └── NotFound.tsx                # 404 page
│   │
│   ├── components/             # Reusable React components
│   │   ├── BeamPlot.tsx                # 3D/2D beam pattern visualization
│   │   ├── HeatmapView.tsx             # Heatmap display component
│   │   ├── SignalProfileView.tsx       # Signal profile visualization
│   │   ├── ComparisonView.tsx          # Comparison view component
│   │   ├── ControlPanel.tsx            # Simulator controls
│   │   ├── ExtraView.tsx               # Additional visualization
│   │   ├── NavLink.tsx                 # Navigation link component
│   │   ├── layout/                     # Layout components
│   │   │   └── MainLayout.tsx          # Main layout wrapper
│   │   └── ui/                         # ShadCN/UI components
│   │       └── [30+ UI components]     # Buttons, inputs, dialogs, etc.
│   │
│   ├── hooks/                  # Custom React hooks
│   │   ├── use5GSimulatorAPI.ts        # 5G API hook
│   │   ├── useRadarSimulatorAPI.ts     # Radar API hook
│   │   ├── useUltrasoundSimulatorAPI.ts# Ultrasound API hook
│   │   ├── useSimulationWithAPI.ts     # General simulation hook
│   │   ├── useBeamformingAPI.ts        # Beamforming API hook
│   │   ├── use-mobile.tsx              # Mobile detection hook
│   │   └── use-toast.ts                # Toast notifications hook
│   │
│   ├── types/                  # TypeScript type definitions
│   │   └── beamforming.ts              # Beamforming-related types
│   │
│   ├── lib/                    # Utility functions
│   │   └── utils.ts                    # Common utilities
│   │
│   ├── test/                   # Frontend tests
│   │   ├── example.test.ts             # Example tests
│   │   └── setup.ts                    # Test setup
│   │
│   ├── App.tsx                 # Root React component
│   ├── main.tsx                # React entry point
│   ├── vite-env.d.ts           # Vite environment types
│   ├── App.css                 # Global app styles
│   └── index.css               # Global styles
│
├── public/                     # Static assets
│   └── robots.txt
│
├── Configuration Files
│   ├── package.json            # Frontend npm dependencies
│   ├── tsconfig.json           # TypeScript configuration
│   ├── tsconfig.app.json       # App TypeScript config
│   ├── tsconfig.node.json      # Node TypeScript config
│   ├── vite.config.ts          # Vite build configuration
│   ├── vitest.config.ts        # Vitest test configuration
│   ├── tailwind.config.ts      # Tailwind CSS configuration
│   ├── postcss.config.js       # PostCSS configuration
│   ├── eslint.config.js        # ESLint configuration
│   ├── components.json         # Component registry
│   └── .gitignore              # Git ignore rules
│
├── dist/                       # Built frontend (generated)
├── node_modules/               # npm dependencies (generated)
└── .git/                        # Git repository
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ (for frontend)
- Python 3.8+ (for backend)
- npm or yarn (for frontend)

### Installation

**Frontend Setup:**
```bash
cd beam-weaver
npm install
```

**Backend Setup:**
```bash
cd backend
pip install -r requirements.txt
```

### Running the Project

**Option 1: Run Both Servers**

Terminal 1 - Backend (FastAPI):
```bash
cd backend
python run_server.py
# Backend runs on http://localhost:5000
```

Terminal 2 - Frontend (Vite):
```bash
npm run dev
# Frontend runs on http://localhost:8080
```

**Option 2: Production Build**

Build frontend:
```bash
npm run build
```

Run backend:
```bash
cd backend
python run_server.py
```

## 📦 Dependencies

### Frontend (React + TypeScript)
- **React 18** - UI library
- **Vite** - Build tool
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **ShadCN/UI** - Component library
- **React Query** - Data fetching
- **Framer Motion** - Animations
- **Vitest** - Testing framework

### Backend (Python)
- **FastAPI** - Web framework
- **Uvicorn** - ASGI server
- **NumPy** - Numerical computing
- **Requests** - HTTP client

## 🔧 Available Commands

### Frontend
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm run test         # Run tests once
npm run test:watch   # Run tests in watch mode
```

### Backend
```bash
python run_server.py          # Start FastAPI server
python test_backend.py        # Run backend tests
python verify_architecture.py # Verify code structure
```

## 📚 Features

### 5G Beamforming Simulator
- Massive MIMO antenna array simulation
- Beam pattern visualization
- Signal processing and analysis
- API endpoint: `/api/simulate/5g`

### Radar Beamforming Simulator
- Radar signal processing
- Beam steering and nulling
- Range/Doppler analysis
- API endpoint: `/api/simulate/radar`

### Ultrasound Beamforming Simulator
- Medical ultrasound simulation
- Phased array beamforming
- Synthetic aperture techniques
- API endpoint: `/api/simulate/ultrasound`

## 🔌 API Endpoints

All endpoints are prefixed with the backend URL (http://localhost:5000)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/simulate/5g` | POST | Run 5G simulation |
| `/api/simulate/radar` | POST | Run Radar simulation |
| `/api/simulate/ultrasound` | POST | Run Ultrasound simulation |
| `/api/health` | GET | Health check |

## 🎨 Architecture

### Frontend Architecture
```
React App
├── Pages (Routable components)
├── Components (UI components)
├── Hooks (API & state management)
├── Types (TypeScript definitions)
└── Utils (Helper functions)
```

### Backend Architecture
```
FastAPI App
├── API Routes
├── Core Engine (Beamforming logic)
├── Simulators (Domain-specific)
└── Service Layer (Business logic)
```

## 🔄 Data Flow

1. **User Input** → ControlPanel component
2. **Request** → Custom React hooks (useXSimulatorAPI)
3. **API Call** → FastAPI backend
4. **Computation** → Core beamforming engine
5. **Response** → JSON with beam patterns & metrics
6. **Visualization** → BeamPlot, HeatmapView components

## 🧪 Testing

### Frontend Tests
```bash
npm run test         # Run all tests
npm run test:watch   # Watch mode
```

### Backend Tests
```bash
python -m pytest backend/test_backend.py
```

## 📝 Configuration Files

- **vite.config.ts** - Frontend build configuration
- **tsconfig.json** - TypeScript compilation rules
- **tailwind.config.ts** - Tailwind CSS customization
- **backend/pyrightconfig.json** - Python type checking
- **backend/requirements.txt** - Python dependencies

## 🛠️ Development

### Adding a New Simulator
1. Create `simulator_new.py` in `backend/simulators/`
2. Implement simulation logic
3. Add API route in `backend/api/routes.py`
4. Create React page in `src/pages/`
5. Add custom hook in `src/hooks/`

### Adding UI Components
1. Use ShadCN/UI component library (in `src/components/ui/`)
2. Create custom components in `src/components/`
3. Use Tailwind CSS for styling

## 📖 Project Documentation

- **Backend README**: `backend/README.md`
- **Frontend README**: Check package.json for scripts
- **Component Registry**: `components.json`

## 🐛 Troubleshooting

### Frontend won't connect to backend
- Ensure backend is running on port 5000
- Check CORS configuration in `backend/app.py`
- Verify API endpoint URLs in hooks

### Backend calculation errors
- Check Python version (3.8+)
- Verify NumPy installation
- Review simulation parameters in API request

### Build failures
- Clear `dist/` and `node_modules/`
- Run `npm install` again
- Check Node version compatibility

## 📄 License

[Add your license information here]

## 👥 Contributors

[Add contributor information here]

---

**Last Updated**: April 2026
**Version**: 1.0.0
