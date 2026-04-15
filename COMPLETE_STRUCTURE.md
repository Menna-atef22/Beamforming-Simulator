# Beamforming-Simulator - Complete Project Documentation

## 📋 Table of Contents
1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Directory Structure](#directory-structure)
4. [Backend Documentation](#backend-documentation)
5. [Frontend Documentation](#frontend-documentation)
6. [Installation & Setup](#installation--setup)
7. [Running the Application](#running-the-application)
8. [API Endpoints](#api-endpoints)
9. [File Reference Guide](#file-reference-guide)

---

## 🎯 Project Overview

**Beamforming-Simulator** is a full-stack web application for simulating and visualizing beamforming patterns across multiple domains:

- **5G Beamforming**: Signal processing for 5G communication systems
- **Radar Beamforming**: Antenna array pattern simulation for radar applications
- **Ultrasound Beamforming**: Medical ultrasound beam focusing and steering

The application consists of:
- **Backend**: Python FastAPI REST API for computations
- **Frontend**: React TypeScript single-page application for visualization

---

## 🛠 Technology Stack

### Backend
| Component | Technology | Version |
|-----------|-----------|---------|
| Web Framework | FastAPI | ≥0.104.0 |
| ASGI Server | Uvicorn | ≥0.24.0 |
| Computation | NumPy | ≥1.24.0 |
| HTTP Client | Requests | ≥2.31.0 |
| Type Checking | Pyright | - |

### Frontend
| Component | Technology | Version |
|-----------|-----------|---------|
| UI Framework | React | Latest |
| Language | TypeScript | Latest |
| Build Tool | Vite | Latest |
| Styling | Tailwind CSS | Latest |
| Testing | Vitest | Latest |
| Linting | ESLint | Latest |

---

## 📁 Directory Structure

```
Beamforming-Simulator/
│
├── backend/                           # Python FastAPI Backend (Port 5000)
│   ├── __init__.py                   # Package initializer
│   ├── app.py                        # FastAPI application main entry point
│   ├── run_server.py                 # Server launcher script
│   ├── service.py                    # Business logic service layer
│   ├── serializers.py                # Data serialization utilities
│   ├── requirements.txt              # Python pip dependencies
│   ├── pyrightconfig.json            # Pyright type checking config
│   │
│   ├── api/                          # API Layer - Routes & Schemas
│   │   ├── __init__.py              # API package initializer
│   │   ├── routes.py                # FastAPI route definitions
│   │   └── schemas.py               # Pydantic request/response models
│   │
│   ├── core/                         # Core Beamforming Engine
│   │   ├── __init__.py              # Core package initializer
│   │   ├── array_model.py           # Linear antenna array mathematical model
│   │   ├── signal_model.py          # Signal propagation & calculations
│   │   ├── noise_model.py           # Gaussian noise modeling
│   │   ├── window_functions.py      # DSP window functions (Hamming, Hanning)
│   │   ├── interference_map.py      # 2D interference pattern generation
│   │   └── beamforming_engine.py    # Main simulation computation engine
│   │
│   ├── simulators/                  # Domain-Specific Simulators
│   │   ├── __init__.py              # Simulators package initializer
│   │   ├── simulator_5g.py          # 5G beamforming simulation
│   │   ├── simulator_radar.py       # Radar beamforming simulation
│   │   └── simulator_ultrasound.py  # Ultrasound beamforming simulation
│   │
│   ├── test_backend.py              # Backend unit tests
│   ├── TEST_RESULTS.py              # Test results documentation
│   └── verify_architecture.py       # Architecture validation script
│
├── frontend/                          # React TypeScript Frontend (Port 8080)
│   ├── index.html                   # HTML entry point
│   ├── vite.config.ts               # Vite build configuration
│   ├── vitest.config.ts             # Vitest testing configuration
│   ├── tsconfig.json                # TypeScript configuration (main)
│   ├── tsconfig.app.json            # TypeScript config for app code
│   ├── tsconfig.node.json           # TypeScript config for node scripts
│   ├── eslint.config.js             # ESLint linting rules
│   ├── postcss.config.js            # PostCSS configuration
│   ├── tailwind.config.ts           # Tailwind CSS configuration
│   ├── components.json              # Component library config
│   ├── package.json                 # Frontend npm dependencies
│   │
│   ├── public/                      # Static Assets
│   │   └── robots.txt              # SEO robots.txt file
│   │
│   └── src/                         # React Source Code
│       ├── index.css               # Global CSS styles
│       ├── App.css                 # App component styles
│       ├── App.tsx                 # Main app component
│       ├── main.tsx                # React app entry point
│       ├── vite-env.d.ts           # Vite environment types
│       │
│       ├── pages/                  # Page Components (Routes)
│       │   ├── Home.tsx            # Landing/home page
│       │   ├── Index.tsx           # Index/dashboard page
│       │   ├── Simulator5G.tsx     # 5G simulator interface
│       │   ├── Simulator5G.css     # 5G simulator styling
│       │   ├── SimulatorRadar.tsx  # Radar simulator interface
│       │   ├── SimulatorRadar.css  # Radar simulator styling
│       │   ├── SimulatorUltrasound.tsx  # Ultrasound simulator interface
│       │   ├── SimulatorUltrasound.css  # Ultrasound simulator styling
│       │   └── NotFound.tsx        # 404 error page
│       │
│       ├── components/             # Reusable React Components
│       │   ├── BeamPlot.tsx        # Beam pattern 2D/3D visualization
│       │   ├── ComparisonView.tsx  # Side-by-side comparison component
│       │   ├── ControlPanel.tsx    # Simulator control panel
│       │   ├── ExtraView.tsx       # Additional data visualization
│       │   ├── HeatmapView.tsx     # Heatmap rendering component
│       │   ├── HeatmapView.css     # Heatmap styling
│       │   ├── SignalProfileView.tsx  # Signal profile visualization
│       │   ├── NavLink.tsx         # Navigation link component
│       │   │
│       │   ├── layout/             # Layout Components
│       │   │   └── MainLayout.tsx # Main application layout
│       │   │
│       │   └── ui/                 # UI Component Library (Shadcn)
│       │       ├── accordion.tsx        # Accordion component
│       │       ├── alert-dialog.tsx    # Alert dialog component
│       │       ├── alert.tsx           # Alert component
│       │       ├── aspect-ratio.tsx    # Aspect ratio wrapper
│       │       ├── avatar.tsx          # Avatar component
│       │       ├── badge.tsx           # Badge component
│       │       ├── breadcrumb.tsx      # Breadcrumb navigation
│       │       ├── button.tsx          # Button component
│       │       ├── calendar.tsx        # Calendar component
│       │       ├── card.tsx            # Card container component
│       │       ├── carousel.tsx        # Carousel component
│       │       ├── chart.tsx           # Chart component
│       │       ├── checkbox.tsx        # Checkbox component
│       │       ├── collapsible.tsx     # Collapsible component
│       │       ├── command.tsx         # Command palette
│       │       ├── context-menu.tsx    # Context menu
│       │       ├── dialog.tsx          # Dialog/modal component
│       │       ├── drawer.tsx          # Drawer component
│       │       ├── dropdown-menu.tsx   # Dropdown menu
│       │       ├── form.tsx            # Form utilities
│       │       ├── hover-card.tsx      # Hover card component
│       │       ├── input-otp.tsx       # OTP input
│       │       ├── input.tsx           # Text input component
│       │       ├── label.tsx           # Label component
│       │       ├── menubar.tsx         # Menu bar component
│       │       ├── navigation-menu.tsx # Navigation menu
│       │       ├── pagination.tsx      # Pagination component
│       │       ├── popover.tsx         # Popover component
│       │       ├── progress.tsx        # Progress bar
│       │       ├── radio-group.tsx     # Radio button group
│       │       ├── ... (additional UI components)
│       │
│       ├── hooks/                  # Custom React Hooks
│       │   ├── use-mobile.tsx           # Mobile detection hook
│       │   ├── use-toast.ts             # Toast notification hook
│       │   ├── use5GSimulatorAPI.ts     # 5G simulator API hook
│       │   ├── useBeamformingAPI.ts     # General beamforming API hook
│       │   ├── useRadarSimulatorAPI.ts  # Radar simulator API hook
│       │   ├── useSimulationWithAPI.ts  # Generic simulation API hook
│       │   └── useUltrasoundSimulatorAPI.ts  # Ultrasound simulator API hook
│       │
│       ├── types/                  # TypeScript Type Definitions
│       │   └── beamforming.ts      # Beamforming data type definitions
│       │
│       ├── lib/                    # Utility Functions
│       │   └── utils.ts            # Helper utility functions
│       │
│       └── test/                   # Frontend Tests
│           ├── example.test.ts     # Example test file
│           └── setup.ts            # Test setup configuration
│
├── package.json                     # Root npm package config (workspace)
├── README.md                        # Main project README
├── PROJECT_README.md               # Detailed project documentation
├── QUICKSTART.md                   # Quick start guide
├── REORGANIZATION_COMPLETE.md      # Reorganization summary
└── COMPLETE_STRUCTURE.md           # This file

```

---

## 📚 Backend Documentation

### Backend Structure
The backend is organized in a layered architecture:

1. **API Layer** (`api/`) - HTTP request handling
2. **Service Layer** (`service.py`) - Business logic
3. **Core Engine** (`core/`) - Computation logic
4. **Simulators** (`simulators/`) - Domain-specific implementations

### Core Backend Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `app.py` | FastAPI application setup | CORS middleware, route registration, health check |
| `run_server.py` | Server launcher | Start Uvicorn server |
| `service.py` | Business logic layer | Orchestrate computations |
| `serializers.py` | Data serialization | Convert numpy arrays to JSON |
| `api/routes.py` | API endpoint definitions | `/simulate`, `/config`, etc. |
| `api/schemas.py` | Data models | Pydantic request/response validation |
| `core/array_model.py` | Antenna array mathematics | Element positions, steering |
| `core/signal_model.py` | Signal calculations | Propagation, phase, amplitude |
| `core/noise_model.py` | Noise generation | Gaussian noise modeling |
| `core/window_functions.py` | DSP windows | Hamming, Hanning, etc. |
| `core/interference_map.py` | Pattern generation | 2D interference maps |
| `core/beamforming_engine.py` | Main simulation | Beam synthesis, computation |
| `simulators/simulator_5g.py` | 5G domain logic | 5G-specific calculations |
| `simulators/simulator_radar.py` | Radar domain logic | Radar-specific calculations |
| `simulators/simulator_ultrasound.py` | Ultrasound domain logic | Ultrasound-specific calculations |

### Backend Configuration Files

| File | Purpose |
|------|---------|
| `requirements.txt` | Python package dependencies |
| `pyrightconfig.json` | Pyright static type checker configuration |

---

## 🎨 Frontend Documentation

### Frontend Architecture
The frontend follows a component-based React architecture with:

1. **Pages** - Full-page components for routes
2. **Components** - Reusable UI components
3. **Hooks** - Custom React hooks for API integration
4. **Types** - TypeScript type definitions
5. **UI Library** - Shadcn components

### Page Components

| Page | File | Purpose |
|------|------|---------|
| Home | `Home.tsx` | Landing/introduction page |
| Dashboard | `Index.tsx` | Dashboard/index page |
| 5G Simulator | `Simulator5G.tsx` | Interactive 5G simulator interface |
| Radar Simulator | `SimulatorRadar.tsx` | Interactive Radar simulator interface |
| Ultrasound Simulator | `SimulatorUltrasound.tsx` | Interactive Ultrasound simulator interface |
| Not Found | `NotFound.tsx` | 404 error page |

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| Beam Pattern | `BeamPlot.tsx` | 2D/3D beam pattern visualization |
| Heatmap | `HeatmapView.tsx` | Interference pattern heatmap |
| Signal Profile | `SignalProfileView.tsx` | Signal strength visualization |
| Comparison | `ComparisonView.tsx` | Side-by-side comparison view |
| Control Panel | `ControlPanel.tsx` | Simulator parameter controls |
| Extra View | `ExtraView.tsx` | Additional data visualization |
| Navigation | `NavLink.tsx` | Navigation link component |
| Layout | `layout/MainLayout.tsx` | Main application layout wrapper |

### API Integration Hooks

| Hook | File | Purpose |
|------|------|---------|
| General Beamforming | `useBeamformingAPI.ts` | Generic beamforming API calls |
| 5G Simulator | `use5GSimulatorAPI.ts` | 5G-specific API integration |
| Radar Simulator | `useRadarSimulatorAPI.ts` | Radar-specific API integration |
| Ultrasound Simulator | `useUltrasoundSimulatorAPI.ts` | Ultrasound-specific API integration |
| Simulation Generic | `useSimulationWithAPI.ts` | Generic simulation API wrapper |
| Mobile Detection | `use-mobile.tsx` | Mobile device detection |
| Toast Notifications | `use-toast.ts` | Toast notification system |

### Frontend Configuration Files

| File | Purpose |
|------|---------|
| `vite.config.ts` | Vite build tool configuration |
| `vitest.config.ts` | Vitest test runner configuration |
| `tsconfig.json` | TypeScript compiler main config |
| `tsconfig.app.json` | TypeScript config for app code |
| `tsconfig.node.json` | TypeScript config for node scripts |
| `eslint.config.js` | ESLint linting rules |
| `postcss.config.js` | PostCSS transformations |
| `tailwind.config.ts` | Tailwind CSS theme & plugin config |
| `components.json` | Shadcn UI component library config |

---

## ⚙️ Installation & Setup

### Prerequisites
- **Node.js 18+** (for frontend)
- **Python 3.8+** (for backend)
- **npm** or **yarn** (for frontend package management)
- **pip** (for Python package management)

### Step 1: Clone the Repository
```bash
git clone https://github.com/yourusername/Beamforming-Simulator.git
cd Beamforming-Simulator
```

### Step 2: Backend Setup
```bash
cd backend
pip install -r requirements.txt
cd ..
```

### Step 3: Frontend Setup
```bash
cd frontend
npm install
cd ..
```

### Option: Install All at Once
```bash
npm run install:all
```

---

## 🏃 Running the Application

### Run Both Servers Together
```bash
npm run dev
```
- Frontend: http://localhost:8080
- Backend: http://localhost:5000

### Run Backend Only
```bash
cd backend
python run_server.py
```
Server runs on: http://localhost:5000

### Run Frontend Only
```bash
cd frontend
npm run dev
```
Application runs on: http://localhost:8080

### Build for Production
```bash
# Frontend build
cd frontend
npm run build

# Backend is production-ready as-is
```

---

## 🔌 API Endpoints

### Health Check
```
GET /health
Response: {"status": "ok", "service": "Beam Weaver Backend", "version": "1.0.0"}
```

### 5G Simulator
```
POST /simulate/5g
Request body: BeamformingConfig (see schemas.py)
Response: Simulation results with beam patterns
```

### Radar Simulator
```
POST /simulate/radar
Request body: BeamformingConfig
Response: Radar beam pattern data
```

### Ultrasound Simulator
```
POST /simulate/ultrasound
Request body: BeamformingConfig
Response: Ultrasound beam pattern data
```

### Configuration Endpoints
```
GET /config/5g
GET /config/radar
GET /config/ultrasound
```

---

## 📖 File Reference Guide

### Backend Files by Category

#### Initialization Files
- `backend/__init__.py` - Marks backend as Python package
- `backend/api/__init__.py` - Marks api as Python package
- `backend/core/__init__.py` - Marks core as Python package
- `backend/simulators/__init__.py` - Marks simulators as Python package

#### Configuration & Runtime
- `backend/requirements.txt` - Lists all Python dependencies
- `backend/pyrightconfig.json` - Configures type checking
- `backend/run_server.py` - Starts the Uvicorn server
- `backend/app.py` - Defines FastAPI application

#### Core Engine
- `backend/core/array_model.py` - Antenna array geometry & mathematics
- `backend/core/signal_model.py` - Signal propagation calculations
- `backend/core/noise_model.py` - Noise generation (Gaussian)
- `backend/core/window_functions.py` - Window functions for DSP
- `backend/core/interference_map.py` - 2D pattern generation
- `backend/core/beamforming_engine.py` - Main computation engine

#### API Layer
- `backend/api/routes.py` - All HTTP endpoint definitions
- `backend/api/schemas.py` - Pydantic models for validation
- `backend/service.py` - Service logic orchestration
- `backend/serializers.py` - JSON serialization utilities

#### Domain Simulators
- `backend/simulators/simulator_5g.py` - 5G beamforming logic
- `backend/simulators/simulator_radar.py` - Radar beamforming logic
- `backend/simulators/simulator_ultrasound.py` - Ultrasound beamforming logic

#### Testing & Validation
- `backend/test_backend.py` - Unit tests
- `backend/TEST_RESULTS.py` - Test documentation
- `backend/verify_architecture.py` - Architecture validation script

### Frontend Files by Category

#### Entry Points
- `frontend/index.html` - HTML entry point
- `frontend/src/main.tsx` - React app entry point
- `frontend/src/App.tsx` - Root app component
- `frontend/src/vite-env.d.ts` - Vite environment types

#### Configuration
- `frontend/vite.config.ts` - Vite build configuration
- `frontend/vitest.config.ts` - Test runner configuration
- `frontend/tsconfig.json` - TypeScript compiler config
- `frontend/tsconfig.app.json` - App code TypeScript config
- `frontend/tsconfig.node.json` - Build scripts TypeScript config
- `frontend/eslint.config.js` - Linting rules
- `frontend/postcss.config.js` - CSS post-processing
- `frontend/tailwind.config.ts` - Tailwind CSS configuration
- `frontend/components.json` - Shadcn component config

#### Styling
- `frontend/src/index.css` - Global styles
- `frontend/src/App.css` - App component styles
- `frontend/src/pages/Simulator5G.css` - 5G simulator styles
- `frontend/src/pages/SimulatorRadar.css` - Radar simulator styles
- `frontend/src/pages/SimulatorUltrasound.css` - Ultrasound simulator styles
- `frontend/src/components/HeatmapView.css` - Heatmap styles

#### Page Components (Routes)
- `frontend/src/pages/Home.tsx` - Home page
- `frontend/src/pages/Index.tsx` - Index/dashboard page
- `frontend/src/pages/Simulator5G.tsx` - 5G simulator page
- `frontend/src/pages/SimulatorRadar.tsx` - Radar simulator page
- `frontend/src/pages/SimulatorUltrasound.tsx` - Ultrasound simulator page
- `frontend/src/pages/NotFound.tsx` - 404 page

#### Core Components
- `frontend/src/components/BeamPlot.tsx` - Beam visualization
- `frontend/src/components/HeatmapView.tsx` - Heatmap visualization
- `frontend/src/components/SignalProfileView.tsx` - Signal display
- `frontend/src/components/ComparisonView.tsx` - Comparison display
- `frontend/src/components/ControlPanel.tsx` - Control interface
- `frontend/src/components/ExtraView.tsx` - Additional views
- `frontend/src/components/NavLink.tsx` - Navigation link
- `frontend/src/components/layout/MainLayout.tsx` - Layout wrapper

#### UI Component Library (Shadcn)
Located in `frontend/src/components/ui/` - 30+ reusable UI components including:
- buttons, inputs, forms, modals, cards, menus, dialogs, etc.

#### Hooks (API Integration)
- `frontend/src/hooks/useBeamformingAPI.ts` - General API integration
- `frontend/src/hooks/use5GSimulatorAPI.ts` - 5G API integration
- `frontend/src/hooks/useRadarSimulatorAPI.ts` - Radar API integration
- `frontend/src/hooks/useUltrasoundSimulatorAPI.ts` - Ultrasound API integration
- `frontend/src/hooks/useSimulationWithAPI.ts` - Generic simulation API
- `frontend/src/hooks/use-mobile.tsx` - Mobile detection
- `frontend/src/hooks/use-toast.ts` - Toast notifications

#### Type Definitions
- `frontend/src/types/beamforming.ts` - Beamforming data types

#### Utilities
- `frontend/src/lib/utils.ts` - Helper functions

#### Tests
- `frontend/src/test/example.test.ts` - Example tests
- `frontend/src/test/setup.ts` - Test configuration

### Root Project Files
- `package.json` - Root workspace configuration
- `README.md` - Main project documentation
- `PROJECT_README.md` - Detailed project info
- `QUICKSTART.md` - Quick start guide
- `REORGANIZATION_COMPLETE.md` - Reorganization summary
- `COMPLETE_STRUCTURE.md` - This comprehensive documentation

---

## 🔧 Development Workflow

### Adding a New API Endpoint
1. Define request/response schema in `backend/api/schemas.py`
2. Implement logic in appropriate `backend/simulators/simulator_*.py` file
3. Add route in `backend/api/routes.py`
4. Test with `backend/test_backend.py`

### Adding a New UI Component
1. Create component file in `frontend/src/components/`
2. Define TypeScript types in `frontend/src/types/beamforming.ts` if needed
3. Use component in pages or other components
4. Add tests in `frontend/src/test/`

### Adding API Integration
1. Create custom hook in `frontend/src/hooks/useXxxxxAPI.ts`
2. Use hook in page or component
3. Add TypeScript types in `frontend/src/types/`

---

## 📦 Dependencies Summary

### Backend (Python)
- **FastAPI** - Modern web framework
- **Uvicorn** - ASGI server
- **NumPy** - Numerical computations
- **Requests** - HTTP client
- **python-multipart** - Form data parsing

### Frontend (Node.js)
- **React** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Shadcn UI** - Component library
- **Vitest** - Testing framework
- **ESLint** - Code linting

---

## 🐛 Troubleshooting

### Backend Issues
- **Port 5000 already in use**: Change port in `run_server.py`
- **Python import errors**: Ensure `backend/` is in `PYTHONPATH`
- **CORS errors**: Check `app.py` middleware configuration

### Frontend Issues
- **Port 8080 already in use**: `npm run dev -- --port 3000`
- **Vite build errors**: Clear `node_modules/` and reinstall
- **TypeScript errors**: Run `npx tsc --noEmit` to check types

---

## 📝 Notes
- All configuration is centralized in config files
- Backend uses async/await for scalability
- Frontend uses React hooks for state management
- Type safety across full stack with TypeScript and Pyright

---

**Last Updated**: 2026-04-15
**Project Status**: Active Development
