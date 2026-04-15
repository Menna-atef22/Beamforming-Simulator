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

### Core Beamforming (Home Page)
The foundation of the application - fundamental beamforming concepts visualization.

**Features:**
- **Interference Heatmap**: 2D visualization of electromagnetic interference patterns in the array field
- **Beam Pattern**: Main lobe and side lobe visualization with beam steering effects
- **Before vs After Comparison**: Shows impact of steering and apodization on beam pattern
- **Signal Profile**: Line-cut analysis at y=2 showing signal amplitude distribution

**Controls:**
- Array element count (4-16 elements)
- Element spacing (0.25-1.5 wavelengths)
- Wavelength adjustment
- Steering angle (-90° to +90°)
- Amplitude control
- SNR (Signal-to-Noise Ratio) tuning
- Window functions (Rectangular, Hamming, Hanning, Blackman, Kaiser)
- Toggle noise simulation
- Toggle apodization

---

### 5G Beamforming Simulator
Advanced massive MIMO simulation for 5G communication systems.

**Features:**
- **5G Coverage Map**: Interactive visualization of tower beam coverage and user positions
  - 3 towers with adjustable beam patterns
  - 2 mobile users with signal strength visualization
  - Real-time coverage area updates
  
- **Signal Strength per User**: Bar chart showing received signal power for each user
  - Color-coded user identification
  - Dynamic updates with parameter changes
  
- **Distance vs Signal**: Line chart showing signal degradation with distance
  - User-to-tower distance relationships
  - Signal attenuation modeling
  
- **Tower Beam Direction**: Pie chart showing beam direction distribution across towers
  - Angular beam allocation
  - Multi-tower coordination visualization

**Technical Aspects:**
- Simulates massive MIMO array systems
- Beam steering for mobile user tracking
- Signal propagation modeling
- Multi-user interference analysis

---

### Radar Beamforming Simulator
Professional radar signal processing with target detection and tracking.

**Features:**
- **Radar Scan (Polar Display)**: 
  - Rotating beam visualization
  - Detected object/target display
  - Range rings (distance markers)
  - Azimuth angle indicators
  - Real-time beam sweep animation
  
- **Distance vs Time (Bar Chart)**:
  - Round-trip delay to detected targets
  - Target distance measurement
  - Multi-target visualization
  
- **Angle Detection (Line Chart)**:
  - Return intensity by angle
  - Beam pattern in detection domain
  - Angular resolution analysis
  
- **Beam Width Effect Comparison**:
  - Variable beam width simulation
  - Resolution vs gain tradeoff
  - Beam width adjustment slider (3-30°)
  - Scan speed control (0.5-10 revolutions/sec)

**Technical Aspects:**
- Pulse radar signal processing
- Doppler velocity estimation
- Radar cross-section (RCS) modeling
- Clutter and noise simulation
- Target detection algorithms

---

### Ultrasound Beamforming Simulator
Medical ultrasound imaging with synthetic aperture and phased array techniques.

**Features:**
- **Phantom View (Organ Layout)**:
  - Anatomical phantom visualization
  - Organ boundaries and structures
  - Ultrasound wave propagation
  - Tissue interaction effects
  
- **A-Mode (Amplitude vs Depth)**:
  - Echo amplitude as function of depth
  - Reflection detection from interfaces
  - Gain and attenuation modeling
  - Reference line markers for known structures
  
- **B-Mode Image**:
  - 2D ultrasound cross-section image
  - Pixel-based intensity mapping
  - Grayscale representation of tissue echoes
  - Real-time image updates
  
- **Probe Direction**:
  - Probe beam direction across scan lines
  - Coverage area visualization
  - Sector angle visualization

**Technical Aspects:**
- Phased array transducer simulation
- Synthetic aperture focusing
- Time gain compensation (TGC)
- Ultrasound frequency selection (2-12 MHz)
- Acoustic impedance effects
- Medical imaging signal processing

---

### Common Features Across All Pages

1. **Real-time Parameter Control**:
   - Instant visualization updates (300ms debounce)
   - Smooth transitions between states
   - No data loss during updates

2. **Advanced Visualizations**:
   - Canvas-based custom rendering (Radar, Ultrasound)
   - Recharts library for interactive charts
   - Responsive grid layouts
   - Dark theme with professional styling

3. **Performance Optimization**:
   - Data memoization with useMemo
   - Debounced parameter updates
   - Efficient re-render prevention
   - Lazy loading of components

4. **API Integration**:
   - Async API calls with proper error handling
   - Loading states and spinners
   - Error alerts and fallbacks
   - Retry mechanisms

---

---

## 🔧 Recent Fixes & Improvements

### Visualization Updates (Smooth, No Reset)
- ✅ Fixed Core page visualization reset bug
- ✅ Implemented 300ms debounce on parameter changes
- ✅ Added data retention between API calls
- ✅ Charts now stay mounted during updates
- ✅ Smooth opacity transitions instead of full component remounts

### Routing & Navigation
- ✅ Fixed Radar page routing (NotFound redirect bug)
- ✅ All simulator pages accessible via navigation menu
- ✅ Clean URL paths: `/`, `/5g`, `/radar`, `/ultrasound`

### Code Quality
- ✅ Removed all inline styles (CSS best practices)
- ✅ Moved styles to external CSS files
- ✅ Fixed unstable array keys in chart rendering
- ✅ Proper error handling in all hooks
- ✅ TypeScript strict mode compliance

### Frontend Polish
- ✅ Updated website title to "Beamforming Simulator"
- ✅ Enhanced meta descriptions
- ✅ Professional dark theme styling
- ✅ Responsive layout for all screen sizes

---



All endpoints are on `http://localhost:5000/api/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/simulate/5g` | POST | Run 5G simulation |
| `/simulate/radar` | POST | Run Radar simulation |
| `/simulate/ultrasound` | POST | Run Ultrasound simulation |
| `/health` | GET | Health check |

---

## � Application Flow

### Page Navigation
```
┌─────────────────────────────────────────────────────────┐
│           Navigation Menu (Top Bar)                      │
│  [Core] [5G] [Radar] [Ultrasound]                       │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼              ▼
    Home (/)      5G (/5g)      Radar (/radar)  Ultrasound (/ultrasound)
    Core Beam     5G Sim        Radar Sim       Ultrasound Sim
```

### Data Flow (Example: 5G Simulator)
```
1. User adjusts parameter (e.g., steering angle)
                    ▼
2. Parameter stored in React state
                    ▼
3. Debounce delay (300ms) - wait for more changes
                    ▼
4. Trigger useEffect with debounced param
                    ▼
5. API call to backend: POST /api/simulate/5g
                    ▼
6. Backend processes (beamforming computation)
                    ▼
7. API response with simulation results
                    ▼
8. Update result state (previous data retained)
                    ▼
9. Memoized data arrays update
                    ▼
10. Canvas and charts re-render smoothly
                    ▼
11. No flicker, no reset, smooth animation
```

---



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
