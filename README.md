# RoadWatch 🛣️
**AI-Powered Road Infrastructure Transparency Platform**

> National Road Safety Hackathon 2026 | IIT Madras CoERS | Track: RoadWatch

---

## What It Does

RoadWatch is an AI-powered platform that enables citizens, engineers, and auditors to:

- **Monitor road quality** — View road type (NH/SH/MDR/VR/Expressway), condition score (1–10), last relaying date, contractor, and surface type
- **Track public spending** — See exact amounts sanctioned vs. spent for any road with official source URLs; auto-flags anomalies below 65%
- **Report road issues** — Upload photos; AI assesses damage type and severity automatically; complaint auto-routed to correct Executive Engineer
- **Hold authorities accountable** — Complaints routed to exact EE by road type + state + country; 4-stage tracking (Filed → Resolved)
- **AI Chatbot** — Groq LLaMA 3.3 70B powered; answers questions about any road in natural language using live database context
- **Works globally** — 35 roads across 13 countries: India, UK, USA, Bangladesh, South Africa, Madagascar, Poland, Germany, Australia, Nigeria, Kenya, Japan, Malaysia
- **Works offline** — Service Worker PWA caches all road data, stats, and authority contacts for low-connectivity areas

---

## Quick Start (3 steps)

### 1. Install dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. (Optional) Add AI API key
```bash
cp .env.example .env
# Edit .env and add your GROQ_API_KEY (free at console.groq.com)
# Without a key, the system uses a comprehensive rule-based AI fallback
```

### 3. Run
```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000** in your browser.

---

## Project Structure

```
roadwatch/
├── backend/
│   ├── main.py             # FastAPI app — 26 API endpoints
│   ├── database.py         # SQLite models (Road, Complaint, BudgetRecord, Authority)
│   ├── ai_engine.py        # Groq LLaMA 3.3 + rule-based chatbot, routing, damage assessment
│   ├── seed_data.py        # 35 roads, 37 authorities, 21 complaints across 13 countries
│   ├── requirements.txt    # All Python dependencies
│   └── .env.example        # API key template
├── frontend/
│   ├── index.html          # Single-page application (7 sections)
│   ├── css/style.css       # Full responsive stylesheet
│   ├── js/app.js           # All frontend logic (map, chatbot, analytics, forms)
│   ├── service-worker.js   # Offline / PWA caching (roadwatch-v3)
│   └── manifest.json       # PWA manifest (installable as mobile app)
├── data/
│   ├── roadwatch.db                  # SQLite database (4 tables)
│   ├── roadwatch_database_dump.sql   # Plain-text SQL dump (readable in Notepad)
│   └── csv_tables/                   # CSV export of all 4 tables
│       ├── roads.csv         (35 rows)
│       ├── complaints.csv    (21 rows)
│       ├── authorities.csv   (37 rows)
│       └── budget_records.csv (37 rows)
├── RoadWatch_Presentation.pptx       # 7-slide presentation
├── RoadWatch_Packages_Assumptions.docx  # Packages + assumptions Word doc
└── README.md
```

---

## Database — 4 Structured Tables

| Table | Rows | Key Fields |
|---|---|---|
| **roads** | 35 | road_id, type, country, state, contractor, EE, budget, condition_score, GPS, source_url |
| **authorities** | 37 | country, road_type, department, name, email, phone, office_address |
| **complaints** | 21 | complaint_id, issue_type, severity, ai_assessment, routed_to_ee, status, filed_at |
| **budget_records** | 37 | road_id, financial_year, amount_sanctioned, amount_spent, source_url |

**Coverage:** 35 roads · 13 countries · 37 EE authorities · 21 complaints · 10 budget anomalies

---

## Key Features

### 1. AI Chatbot (Groq LLaMA 3.3 70B)
- **Rule-based first** — instant answers for 40+ query types using live DB data
- **Groq LLaMA fallback** — open-ended questions answered with full database context
- Questions answered: road condition, budget anomalies, critical roads, authority contacts, complaint status, country coverage
- Auto-detects road ID from message text (NH-44, M1-UK, I-95-US, etc.)

### 2. Road Information
- Road type: NH / SH / MDR / ODR / VR / Expressway / PMGSY / Motorway / Interstate
- Condition score (1–10), last relaying date, next maintenance
- Contractor name + contact, Executive Engineer name + email + phone
- Department (NHAI / State PWD / District Highways / Municipal Corp)
- Official government data source URL for every field

### 3. Budget Transparency
- Sanctioned vs. spent amounts per road with source document links
- Multi-year budget history per road
- Auto-anomaly flag when utilisation < 65% (10 roads flagged)
- Analytics section: charts + anomaly table + road comparison tool

### 4. Smart Complaint Routing
- Auto-routes to exact EE by road type + state + country:
  - NH → NHAI Regional Executive Engineer
  - SH → State PWD Executive Engineer
  - MDR/ODR → District Highways Divisional Engineer
  - VR → Municipal Corp / Gram Panchayat Engineer
  - PMGSY → District PMGSY Engineer
- Photo upload → AI damage assessment (type, severity, confidence, action)
- Complaint ID: RW-2026-XXXXX with 4-stage progress tracking

### 5. Interactive Map
- Leaflet.js with MarkerCluster — 35 colour-coded markers across 13 countries
- Click marker → full road details + budget chart + complaint timeline in sidebar
- Near Me (GPS) — finds roads within radius
- Filter by condition, road type, country

### 6. Analytics Dashboard
- 4 charts: condition distribution, avg score by country, complaint severity, budget by type
- Budget anomaly table with direct road links
- Road comparison tool (up to 4 roads side-by-side)

### 7. Offline / PWA
- Service Worker caches road data, stats, authority contacts, and all static assets
- Works fully in low-connectivity rural areas
- Installable as mobile app (Add to Home Screen)

---

## API Endpoints (26 total)

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/roads | List roads (filter: country, type, condition, search) |
| GET | /api/roads/{id} | Full road detail + budget history |
| GET | /api/roads/nearby | Roads near GPS coordinates |
| GET | /api/stats | Dashboard statistics (35 roads, 13 countries, etc.) |
| GET | /api/analytics/overview | Charts data + anomaly list |
| POST | /api/chat | AI chatbot (Groq + rule-based) |
| POST | /api/complaints | File complaint with photo upload |
| GET | /api/complaints/{id} | Track complaint by ID or phone |
| GET | /api/authorities/all | Authority directory |
| GET | /api/health | API health + AI provider status |

---

## Evaluation Criteria Coverage

| Criterion | How RoadWatch Addresses It |
|---|---|
| **Data Accuracy** | 35 roads with contractor, EE, relaying date, source URL — all fields verified |
| **Complaint Routing** | Auto-routes to exact EE by road type + state + country — 37 authorities mapped |
| **Budget Transparency** | Sanctioned vs spent with source links; <65% auto-flagged as anomaly |
| **Global Applicability** | 13 countries, multi-currency, localised authority systems |
| **Offline Functionality** | Service Worker PWA — works without internet |
| **UI & Accessibility** | Responsive, ARIA labels, keyboard navigation, mobile hamburger menu |
| **AI Integration** | Groq LLaMA 3.3 70B chatbot + CV damage assessment |

---

## Technologies Used

- **Backend:** Python 3.12, FastAPI, SQLAlchemy, SQLite, Uvicorn
- **AI Chatbot:** Groq API (LLaMA 3.3-70b-versatile) → OpenAI (GPT-3.5) → Rule-based fallback
- **Damage Assessment:** OpenAI Vision API (GPT-4o-mini) / structured rule-based classifier
- **Frontend:** Vanilla JS ES6+, HTML5, CSS3 (no build step needed)
- **Maps:** Leaflet.js 1.9.4 + MarkerCluster with OpenStreetMap tiles
- **Charts:** Chart.js 4.4.0
- **Markdown:** marked.js 9.1.6 (chatbot responses)
- **Offline:** Service Worker API + localStorage caching
- **Database:** SQLite (dev) — production-ready schema, swap to PostgreSQL in one line

---

## Running Without API Keys

The app works **100% without any API keys**:
- Chatbot uses comprehensive rule-based engine (40+ handlers, live DB context)
- Damage assessment uses structured classifier
- All 26 API endpoints work fully
- All 7 frontend sections work fully

---

*Built for the National Road Safety Hackathon 2026 — CoERS, IIT Madras*
