# Vision Station

Industrial vision inspection station for **Reflector Assy HL GJRA**.

The built-in Reflector Assy HL GJRA example uses eight screw positions. New product masters can configure their own component classes and required ROI counts. Each workpiece is aligned against its approved master and classified deterministically as **OK**, **NG**, or **INVALID**.

## Core workflow

1. **Master Setup** — Engineering chooses the existing eight-screw Example Master or registers a new product, then configures its master image, alignment anchors, required component ROIs, tolerances, and any required close-up references.
2. **Part Detection** — The camera monitors the configured detection zone and waits for the workpiece to settle.
3. **Alignment** — Fiducial anchors determine translation, rotation, scale, and residual error before inspection.
4. **Inspection** — Each required ROI is checked for presence, confidence, and position tolerance. The example master uses screw references; custom classes require a compatible model or an explicitly configured inspection method. Unexpected objects are screened where supported.
5. **Rule Engine** — The configured master remains authoritative. Alignment failures are reported as system errors; part defects produce NG.
6. **Re-arm** — After a judgement, the station waits for removal or a meaningful replacement/repositioning change before allowing another inspection.
7. **History** — Inspection results are committed to station-local IndexedDB first. Optional Supabase synchronization is disabled unless explicitly enabled.

## Production architecture

This repository is the **production/on-premise Vision-AI variant**. It does not require AWS Lambda, Amazon S3, API Gateway, or another AWS runtime for inspection.

The inspection decision runs locally in the browser/device. OpenCV 5 performs image preprocessing, alignment-related processing, and classical ROI measurements; optional YOLO ONNX inference provides class-aware detections and supporting position evidence. Master/ROI rules and the deterministic rule engine remain authoritative for final judgement. Master settings and inspection history are stored in local IndexedDB. Supabase is optional and is not a runtime requirement.

The AWS/OpenCV 5 hackathon implementation is maintained separately in the `Vision-AI-AWS` repository and is intentionally not part of this production runtime.

## Local-first history and optional cloud sync

Master configurations (including uploaded reference-image data) and inspection history are persisted in station-local IndexedDB, so the station can run without AWS or Supabase. Existing history in the legacy `localStorage` key is migrated into IndexedDB and the legacy key is removed only after the IndexedDB transaction commits. Do not clear browser data before confirming important records have been exported/backed up.

Supabase sync is disabled by default. The feature flag exists, but **do not enable it yet**: the current app has no authenticated station/user identity, so safe least-privilege RLS policies cannot be defined. Without `VITE_ENABLE_SUPABASE_SYNC=true`, no Supabase requests are made.

The application uses the Supabase REST Data API with the browser-safe **publishable key**. Supabase recommends exposing only the required tables/functions and protecting them with Row Level Security (RLS). urlSupabase JavaScript installation docshttps://supabase.com/docs/reference/javascript/installing

Create a Supabase project, then run this SQL in its SQL Editor:

```sql
create table if not exists public.inspection_history (
  id text primary key,
  timestamp timestamptz not null,
  product_id text not null,
  product_code text not null,
  product_name text not null,
  master_id text not null,
  master_revision_id text not null,
  master_revision_code text not null,
  judgement text not null check (judgement in ('OK', 'NG', 'INVALID')),
  expected_count integer not null,
  detected_count integer not null,
  defects jsonb not null default '[]'::jsonb,
  primary_reason text not null default '',
  metrics jsonb not null default '{}'::jsonb,
  alignment jsonb not null default '{}'::jsonb,
  roi_results jsonb not null default '[]'::jsonb,
  extra_objects jsonb not null default '[]'::jsonb,
  thumbnail_base64 text,
  device_id text not null,
  operator_id text,
  sequence_number bigint,
  plc_interlock_state text,
  plc_comm_latency_ms numeric,
  plc_timeline jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inspection_history_timestamp_idx
  on public.inspection_history (timestamp desc);
create index if not exists inspection_history_product_idx
  on public.inspection_history (product_id);
create index if not exists inspection_history_judgement_idx
  on public.inspection_history (judgement);
create index if not exists inspection_history_device_idx
  on public.inspection_history (device_id);

alter table public.inspection_history enable row level security;

drop policy if exists "inspection_history_select" on public.inspection_history;
drop policy if exists "inspection_history_insert" on public.inspection_history;
drop policy if exists "inspection_history_update" on public.inspection_history;
drop policy if exists "inspection_history_delete" on public.inspection_history;

-- Intentionally do not add permissive anon/authenticated policies or grants.
-- Configure authenticated, least-privilege RLS policies only after the
-- application has a verified user/device identity and authorization model.
```

**Security requirement:** the application does not yet implement Supabase Auth or a trusted station identity. Keep cloud sync disabled until an authenticated authorization design and least-privilege RLS policies are implemented and reviewed. Do not enable broad `anon` read/write access to production inspection records. Local IndexedDB remains the supported default.

Create `.env.local` in the project root only if cloud sync is approved:

```env
VITE_ENABLE_SUPABASE_SYNC=true
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

## Optional YOLO model

YOLO runs in the browser through ONNX Runtime Web only when a compatible YOLOv8-style detection ONNX model is supplied. Model weights are intentionally not committed. Configure the model path and class labels in `.env.local`:

```env
VITE_YOLO_MODEL_URL=/models/inspection-yolo.onnx
VITE_YOLO_INPUT_SIZE=640
VITE_YOLO_CONFIDENCE=0.35
VITE_YOLO_IOU=0.45
VITE_YOLO_CLASS_NAMES=screw,fastener,bolt
VITE_YOLO_SCREW_CLASS_NAMES=screw,fastener,bolt
```

Place the approved model at the configured public path. The parser expects a batch-1 YOLOv8 detection output tensor, and configured label count/order must match the model output. Master Setup shows whether the configured label map contains the selected class. For a supported class, a valid inference with no detection in a required ROI can produce a missing-part NG; a class not declared by the model or an inference failure remains uncertain/INVALID. Verify output shape, class order, confidence calibration, and representative production images before trial use. YOLO is never the final OK/NG/INVALID authority.

The internal-server adapter now uses the configurable local HTTP API documented below. It remains opt-in; the local IndexedDB backend stays active until a successful connection test and explicit activation. Review the shared-token and JSON-file persistence limitations before using it beyond a controlled development LAN.

Do **not** put a Supabase secret/service-role key in the browser or commit it to GitHub. The browser should use only the publishable key with RLS enabled. urlSupabase API keys guidancehttps://supabase.com/docs/guides/getting-started/api-keys

The URL and publishable key can be copied from the Supabase project's Connect/API settings. urlSupabase React quickstarthttps://supabase.com/docs/guides/getting-started/quickstarts/reactjs

## Computer-vision pipeline and validation

The runtime follows a layered inspection design:

1. Camera acquisition and image-quality checks.
2. OpenCV preprocessing and master alignment.
3. ROI inspection using configured master geometry and visual references.
4. Optional YOLO ONNX detection, with aspect-preserving letterbox preprocessing and class-aware, one-to-one ROI association.
5. Deterministic rule evaluation for `OK`, `NG`, or `INVALID`; persistence is not used to decide or release a PLC interlock.

YOLO class names in the UI are configuration only: they do not train the model. The deployed ONNX model must support the configured class and its `VITE_YOLO_CLASS_NAMES` order must match the model output. A missing detection is not automatically proof of a missing component; ambiguous evidence must remain uncertain/invalid according to the rule policy. Real camera commissioning and representative normal/abnormal-image validation are required before production use.

CI runs TypeScript checking, the recognizer fixture audit, a source-contract architecture audit, and a production build. These checks do not replace visual validation with actual production images.

## Engineering configuration

Engineering settings currently use a client-side PIN gate for demonstration/convenience only. Because the PIN check is shipped in browser code, it can be inspected or bypassed and is **not production authentication**. Do not expose the UI as a secured production station until managed authentication and controlled device/network access are implemented. The engineering area provides:

- Master and revision management
- Master image and reference-image upload
- Four-point fiducial alignment
- Configurable required ROI count and component class; the built-in example uses eight screw ROIs
- Position, confidence, rotation, and stabilization tolerances
- Camera selection and background calibration
- PLC protocol and interlock configuration
- Runtime diagnostics

The operator view is intentionally focused on the live camera inspection and final judgement.

## Hardware and integration

The station supports browser camera input and an engineering simulator for deterministic dry-runs. PLC communication is isolated behind an adapter so a real industrial gateway can be integrated without changing the inspection rule layer.

The browser is not a safety controller. Machine safety, guarding, and safety interlocks must remain implemented in the appropriate industrial control and safety hardware.

## Local development

Requirements: Node.js and npm.

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
npm run preview
```

## Commissioning checklist

Before line use:

- Configure the Supabase project and `.env.local` values.
- Upload the approved master image.
- Upload all eight approved close-up reference images.
- Verify all four alignment anchors against the fixture.
- Verify all eight screw ROIs and their tolerances.
- Calibrate the empty background under production lighting.
- Validate OK, missing-screw, position-error, extra-object, alignment-error, and replacement-part scenarios using representative images.
- Verify an inspection written from one device is visible from a second device.
- Validate camera mounting, lighting, PLC handshake, and machine safety with the responsible engineering team.

## Project structure

- `src/vision` — alignment, presence, ROI inspection, OpenCV-assisted detection, and rule evaluation
- `src/hooks` — camera and inspection pipeline orchestration
- `src/components` — operator, engineering, settings, history, and integration interfaces
- `src/services` — cloud history persistence, master/runtime configuration, audio, and PLC adapters
- `public/master-images` — reserved for approved master assets supplied during commissioning

This repository intentionally contains no bundled production reference imagery until the approved master asset is committed during commissioning.

## Storage and internal server configuration

The **Settings → Storage & Server** screen controls the runtime storage target and server read/write permissions.

- **Local Station** uses browser IndexedDB.
- **Local Company Server** uses the authenticated internal HTTP API implemented in `server/local-storage-server.mjs`.
- Master reads/writes/deletes and inspection-history reads/writes/clears follow the active target. When the server target is active, API failures are surfaced; the app does not silently write to IndexedDB as a fallback.
- The server API persists data to a JSON file (default `data/vision-store.json`) using atomic file replacement. Back up this file and restrict filesystem access. This is an initial on-premise MVP, not a substitute for a managed production database or enterprise identity provider.
- **Test connection** checks the API URL and bearer token before activation. **Migrate local data & activate** sends an explicit snapshot of local masters and history, merges by ID, and keeps the original IndexedDB data. If an ID exists on the server with different content, the migration is rejected rather than overwriting that record. **Activate without migration** is available only after connection testing and requires confirmation.
- Legacy browser settings that only saved a server draft remain on Local Station until the new runtime configuration version is explicitly activated.

### Start the internal storage API (Windows PowerShell)

Run these commands in the repository folder on the computer that will host the API:

```powershell
$env:VISION_SERVER_TOKEN = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$env:VISION_SERVER_PORT = "8787"
$env:VISION_CORS_ORIGINS = "http://localhost:3000,http://localhost:4173"
npm run server:local
```

Keep the generated token in a secure place for configuring each authorized station. The server refuses to start if the token is shorter than 32 characters. The API listens on port 8787 by default and stores records in `data/vision-store.json` relative to the working directory. To use a different data path, set `VISION_SERVER_DATA_FILE`.

If the browser opens the frontend from a different origin (for example `http://192.168.1.20:3000`), add that exact origin to `VISION_CORS_ORIGINS` before starting the API. Configure the Windows firewall for the API port only on the trusted internal network. In the UI, set the base URL to `http://SERVER-IP:8787/api`, enter the same token, and run **Test connection**.

### Security and operational limits

This first server implementation uses a shared bearer token and JSON-file persistence. The token is stored in the browser's localStorage and can be inspected by a user with access to that browser; it is not enterprise-grade user authentication. Keep the API on a trusted isolated LAN, do not expose it directly to the internet, and use HTTPS/reverse proxy plus managed identity and a managed database before production deployment. The API includes origin allowlisting, a body-size limit, token comparison, and serialized atomic file writes, but those controls do not replace an IT/security review.

Server mode has no automatic offline fallback or bidirectional synchronization. If the API is unavailable, server operations fail explicitly. Returning to Local Station switches reads/writes back to that station's existing IndexedDB; it does not automatically copy server data back. Treat migration and backup as explicit operational steps.

## Dynamic product master setup

The Master Setup entry screen offers two workflows:

- **Example Master** opens the existing Reflector Assy HL GJRA example with its eight screw ROIs and reference images. It does not reset or overwrite the example.
- **New Product** registers a product name and part number, selects focus zone A/B/C, sets the model class name, and defines the expected component quantity. The new master starts with a fresh ROI list and no inherited golden-reference images.

The selected quantity creates that many provisional ROI points. Upload the approved master image, drag each ROI to the real part location, and add a golden reference to every required screw ROI before trial use. The quantity must match the number of required ROIs. The example master remains an example; new products are stored independently.

YOLO class matching uses the labels configured in `VITE_YOLO_CLASS_NAMES`, in the same order as the trained model's output classes. Entering a new class name in Master Setup does not train the model. A custom class must already exist in the deployed model. Non-screw ROIs require class-aware YOLO confirmation; the final judgement remains with the deterministic rule engine.
