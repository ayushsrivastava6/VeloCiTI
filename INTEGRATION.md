# VeloCiTI End-to-End Integration

This branch connects the three existing prototypes:

```text
Portotype (ANPR / CCTV)
        |
        | /api/traffic
        v
portotype_bridge.py
        |
        | POST /api/vision
        v
CityFlow + Multi-Agent Controller
        |
        | /api/state
        v
ClearWays React Command Center
```

## Ports

- Portotype: `http://127.0.0.1:5000`
- CityFlow: `http://127.0.0.1:5002`
- ClearWays Vite: normally `http://localhost:5173`

## Start the systems

### 1. Portotype

```bash
cd portotype
pip install -r requirements.txt
python server.py
```

Portotype exposes `/api/traffic` and continues to provide the ANPR/CCTV pipeline.

### 2. CityFlow

CityFlow must be installed separately as required by the existing project.

```bash
cd "city flow model"
python server.py
```

The server now exposes:

- `GET /api/state` — simulation + agent + vision state
- `POST /api/vision` — receives normalized Portotype observations
- `DELETE /api/vision` — disconnects the external vision feed
- existing control/incident/ambulance/override endpoints

### 3. Portotype -> CityFlow bridge

In another terminal:

```bash
cd "city flow model"
python portotype_bridge.py
```

The bridge polls Portotype every two seconds and forwards camera observations to CityFlow.

### Camera mapping

For real deployments, explicitly map camera IDs to CityFlow junction phases:

**PowerShell:**

```powershell
$env:CAMERA_MAP_JSON='{"CAM_J1_EW":{"junction":"J1","phase":"EW"},"CAM_J1_NS":{"junction":"J1","phase":"NS"},"CAM_J2_EW":{"junction":"J2","phase":"EW"},"CAM_J2_NS":{"junction":"J2","phase":"NS"}}'
python portotype_bridge.py
```

The bridge can infer mappings when camera IDs/names/road fields contain patterns such as `J1 EW` or `J2 NS`, but explicit mappings are recommended.

### 4. ClearWays

```bash
cd ClearWays-main/clearways-react
npm install
npm run dev
```

The dashboard now polls CityFlow at `http://localhost:5002/api/state`.

To use another CityFlow URL:

```text
VITE_CITYFLOW_URL=http://localhost:5002
```

## What is now connected

### Vision -> traffic intelligence

Portotype's per-camera unique vehicle counts and average speeds become junction/phase observations for the CityFlow agents.

### Traffic intelligence -> command center

ClearWays receives the live CityFlow agent state, including:

- current phase
- queue length
- density
- average speed
- allocated green duration
- decision reason
- emergency state
- incident state

The first five ClearWays nodes are backed by CityFlow when the connection is available. The remaining UI nodes remain available as the existing local fallback.

### Emergency corridor

Starting the ClearWays emergency corridor now calls CityFlow's `/api/ambulance` endpoint, activating the existing multi-junction ambulance preemption logic.

### Manual control

Manual lane actions on a CityFlow-backed node call `/api/override` so the command-center action reaches the simulation controller.

## Important architecture note

Portotype currently exposes camera-level traffic summaries, not lane geometry. Therefore the bridge intentionally requires a camera-to-junction/phase mapping instead of pretending that a camera automatically corresponds to a specific signal phase. Queue length is currently passed as zero unless Portotype provides a phase-level queue measurement.

This keeps the integration honest while leaving a clean place to add calibrated lane/ROI measurements later.
