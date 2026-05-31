"""
RoadWatch — FastAPI Backend (v3 Final)
National Road Safety Hackathon 2026 | IIT Madras CoERS | Track: RoadWatch
"""

import os, uuid, json, math, csv, io
from datetime import datetime
from typing import Optional, List
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from database import get_db, Road, Complaint, BudgetRecord, Authority, create_tables
from ai_engine import get_ai_response, route_complaint, assess_road_damage
from seed_data import seed

# ── App setup ──────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent.parent
# On Vercel filesystem is read-only except /tmp
if os.getenv("VERCEL") or os.getenv("VERCEL_ENV"):
    UPLOADS_DIR = Path("/tmp/uploads")
else:
    UPLOADS_DIR = BASE_DIR / "data" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

create_tables()
seed()

app = FastAPI(title="RoadWatch API", version="3.0.0",
              description="AI-powered road infrastructure transparency platform")

app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

FRONTEND_DIR = BASE_DIR / "frontend"

# Serve individual static files via explicit routes
@app.get("/css/style.css")
def serve_css():
    return FileResponse(str(FRONTEND_DIR / "css" / "style.css"), media_type="text/css")

@app.get("/js/app.js")
def serve_js():
    return FileResponse(str(FRONTEND_DIR / "js" / "app.js"), media_type="application/javascript")

@app.get("/manifest.json")
def serve_manifest():
    f = FRONTEND_DIR / "manifest.json"
    return FileResponse(str(f)) if f.exists() else {"name": "RoadWatch"}

@app.get("/service-worker.js")
def serve_sw():
    f = FRONTEND_DIR / "service-worker.js"
    from fastapi.responses import Response
    if f.exists():
        return Response(content=f.read_text(encoding="utf-8"), media_type="application/javascript")
    return Response("", media_type="application/javascript")

# ── Pydantic ───────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    road_id: Optional[str] = None
    conversation_history: Optional[List[dict]] = []

class ComplaintStatusUpdate(BaseModel):
    status: str
    resolution_note: Optional[str] = None

# ── Helpers ────────────────────────────────────────────────────────────────────
def road_to_dict(road: Road) -> dict:
    return {
        "id": road.id, "road_id": road.road_id, "road_name": road.road_name,
        "road_type": road.road_type, "country": road.country, "state": road.state,
        "district": road.district, "contractor_name": road.contractor_name,
        "contractor_contact": road.contractor_contact,
        "executive_engineer": road.executive_engineer,
        "ee_email": road.ee_email, "ee_phone": road.ee_phone,
        "department": road.department, "total_length_km": road.total_length_km,
        "construction_date": road.construction_date,
        "last_relayed_date": road.last_relayed_date,
        "next_maintenance": road.next_maintenance,
        "surface_type": road.surface_type,
        "condition_score": road.condition_score,
        "condition_label": road.condition_label,
        "budget_sanctioned": road.budget_sanctioned,
        "budget_spent": road.budget_spent,
        "currency": road.currency or "INR",
        "financial_year": road.financial_year,
        "data_source": road.data_source,
        "data_source_label": road.data_source_label,
        "lat_start": road.lat_start, "lon_start": road.lon_start,
        "lat_end": road.lat_end, "lon_end": road.lon_end,
        "lat_center": road.lat_center, "lon_center": road.lon_center,
    }

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat/2)**2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon/2)**2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def safe_util_pct(spent, sanctioned):
    """Safe budget utilisation percentage."""
    if not sanctioned or sanctioned == 0:
        return None
    return round((spent / sanctioned) * 100, 1)

# ── Core routes ────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    idx = FRONTEND_DIR / "index.html"
    return FileResponse(str(idx)) if idx.exists() else {"msg": "RoadWatch API v3.0"}

@app.get("/api/health")
def health():
    from ai_engine import GROQ_API_KEY, OPENAI_API_KEY
    if GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here":
        ai_provider = "groq/llama-3.3-70b-versatile"
    elif OPENAI_API_KEY and OPENAI_API_KEY != "":
        ai_provider = "openai/gpt-3.5-turbo"
    else:
        ai_provider = "rule_based"
    return {
        "status": "ok",
        "version": "3.0.0",
        "platform": "RoadWatch",
        "ai_provider": ai_provider,
        "hackathon": "IIT Madras National Road Safety Hackathon 2026",
    }

# ── Roads ──────────────────────────────────────────────────────────────────────
@app.get("/api/roads")
def list_roads(
    country: Optional[str] = None,
    road_type: Optional[str] = None,
    state: Optional[str] = None,
    condition: Optional[str] = None,
    q: Optional[str] = None,
    sort: Optional[str] = "condition_asc",
    page: int = 1,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    query = db.query(Road)
    if country:   query = query.filter(Road.country.ilike(f"%{country}%"))
    if road_type: query = query.filter(Road.road_type.ilike(f"%{road_type}%"))
    if state:     query = query.filter(Road.state.ilike(f"%{state}%"))
    if condition: query = query.filter(Road.condition_label.ilike(f"%{condition}%"))
    if q:
        query = query.filter(or_(
            Road.road_id.ilike(f"%{q}%"), Road.road_name.ilike(f"%{q}%"),
            Road.state.ilike(f"%{q}%"), Road.contractor_name.ilike(f"%{q}%"),
            Road.country.ilike(f"%{q}%"), Road.district.ilike(f"%{q}%")
        ))
    if sort == "condition_asc":   query = query.order_by(Road.condition_score.asc())
    elif sort == "condition_desc":query = query.order_by(Road.condition_score.desc())
    elif sort == "budget_desc":   query = query.order_by(Road.budget_sanctioned.desc())
    elif sort == "name":          query = query.order_by(Road.road_name.asc())

    total = query.count()
    roads = query.offset((page - 1) * limit).limit(limit).all()
    result = [road_to_dict(r) for r in roads]
    # Append budget anomaly flag inline
    for d in result:
        san = d.get("budget_sanctioned") or 0
        sp  = d.get("budget_spent") or 0
        d["budget_anomaly"] = bool(san > 0 and sp > 0 and (sp / san) < 0.65)
        d["budget_utilisation_pct"] = safe_util_pct(sp, san)
    return {"roads": result, "total": total, "page": page, "limit": limit}

@app.get("/api/roads/search/autocomplete")
def autocomplete(q: str = "", db: Session = Depends(get_db)):
    if len(q) < 2:
        return []
    roads = db.query(Road).filter(or_(
        Road.road_id.ilike(f"%{q}%"), Road.road_name.ilike(f"%{q}%"),
        Road.state.ilike(f"%{q}%"), Road.district.ilike(f"%{q}%")
    )).limit(8).all()
    return [{"road_id": r.road_id, "road_name": r.road_name,
             "country": r.country, "state": r.state,
             "condition_label": r.condition_label,
             "road_type": r.road_type} for r in roads]

@app.get("/api/roads/nearby")
def nearby_roads(lat: float, lon: float, radius_km: float = 200,
                 db: Session = Depends(get_db)):
    roads = db.query(Road).filter(
        Road.lat_center.isnot(None), Road.lon_center.isnot(None)
    ).all()
    results = []
    for r in roads:
        dist = haversine(lat, lon, r.lat_center, r.lon_center)
        if dist <= radius_km:
            d = road_to_dict(r)
            d["distance_km"] = round(dist, 1)
            results.append(d)
    results.sort(key=lambda x: x["distance_km"])
    return results[:10]

@app.get("/api/roads/{road_id_str}/timeline")
def road_timeline(road_id_str: str, db: Session = Depends(get_db)):
    """Returns a unified timeline of budget records + complaints for a road."""
    road = (db.query(Road).filter(Road.road_id == road_id_str).first() or
            db.query(Road).filter(Road.road_id.ilike(f"%{road_id_str}%")).first())
    if not road:
        raise HTTPException(404, "Road not found")

    events = []

    # Budget events
    for b in db.query(BudgetRecord).filter(BudgetRecord.road_id == road.id).all():
        events.append({
            "type": "budget", "date": b.work_start or b.financial_year,
            "title": f"Budget — {b.work_type} ({b.financial_year})",
            "detail": f"Sanctioned: {b.amount_sanctioned} {b.currency} | Spent: {b.amount_spent} {b.currency}",
            "source": b.source_label, "source_url": b.source_url,
        })

    # Complaint events
    for c in db.query(Complaint).filter(Complaint.road_id == road.id)\
               .order_by(Complaint.filed_at.asc()).all():
        events.append({
            "type": "complaint", "date": c.filed_at.isoformat() if c.filed_at else None,
            "title": f"{c.issue_type} — {c.severity} Severity",
            "detail": c.description, "status": c.status,
            "complaint_id": c.complaint_id,
        })

    # Sort by date
    events.sort(key=lambda x: x.get("date") or "")
    return {"road_id": road_id_str, "road_name": road.road_name, "events": events}

@app.get("/api/roads/{road_id_str}")
def get_road(road_id_str: str, db: Session = Depends(get_db)):
    road = (db.query(Road).filter(Road.road_id == road_id_str).first() or
            db.query(Road).filter(Road.road_id.ilike(f"%{road_id_str}%")).first())
    if not road:
        raise HTTPException(404, "Road not found")

    budget_history = db.query(BudgetRecord).filter(BudgetRecord.road_id == road.id).all()
    complaints_count = db.query(Complaint).filter(Complaint.road_id == road.id).count()
    open_count = db.query(Complaint).filter(
        Complaint.road_id == road.id,
        Complaint.status.in_(["Filed", "Acknowledged", "In Progress"])
    ).count()

    d = road_to_dict(road)
    d["complaints_count"] = complaints_count
    d["open_complaints"] = open_count
    d["budget_history"] = [{
        "financial_year": b.financial_year, "work_type": b.work_type,
        "amount_sanctioned": b.amount_sanctioned, "amount_spent": b.amount_spent,
        "currency": b.currency, "contractor": b.contractor,
        "work_start": b.work_start, "work_end": b.work_end,
        "source_url": b.source_url, "source_label": b.source_label,
        "verified": b.verified,
    } for b in budget_history]

    san = road.budget_sanctioned or 0
    sp  = road.budget_spent or 0
    d["budget_anomaly"] = bool(san > 0 and sp > 0 and (sp / san) < 0.65)
    d["budget_utilisation_pct"] = safe_util_pct(sp, san)
    return d

@app.get("/api/countries")
def list_countries(db: Session = Depends(get_db)):
    rows = db.query(Road.country).distinct().all()
    return {"countries": [r[0] for r in rows]}

@app.get("/api/road_types")
def list_road_types(db: Session = Depends(get_db)):
    rows = db.query(Road.road_type).distinct().all()
    return {"road_types": [r[0] for r in rows]}

# ── Analytics ──────────────────────────────────────────────────────────────────
@app.get("/api/analytics/overview")
def analytics_overview(db: Session = Depends(get_db)):
    roads = db.query(Road).all()

    cond_dist = {}
    for r in roads:
        label = r.condition_label or "Unknown"
        cond_dist[label] = cond_dist.get(label, 0) + 1

    by_country = {}
    for r in roads:
        c = r.country
        if c not in by_country:
            by_country[c] = {"total": 0, "avg_score": 0, "scores": []}
        by_country[c]["total"] += 1
        if r.condition_score:
            by_country[c]["scores"].append(r.condition_score)
    for c in by_country:
        s = by_country[c]["scores"]
        by_country[c]["avg_score"] = round(sum(s)/len(s), 1) if s else 0
        del by_country[c]["scores"]

    by_type = {}
    for r in roads:
        t = r.road_type
        if t not in by_type:
            by_type[t] = {"total": 0, "avg_score": 0, "scores": []}
        by_type[t]["total"] += 1
        if r.condition_score:
            by_type[t]["scores"].append(r.condition_score)
    for t in by_type:
        s = by_type[t]["scores"]
        by_type[t]["avg_score"] = round(sum(s)/len(s), 1) if s else 0
        del by_type[t]["scores"]

    budget_by_country = {}
    for r in roads:
        c = r.country
        if c not in budget_by_country:
            budget_by_country[c] = {"sanctioned": 0, "spent": 0, "currency": r.currency or "INR"}
        budget_by_country[c]["sanctioned"] += r.budget_sanctioned or 0
        budget_by_country[c]["spent"]      += r.budget_spent or 0

    comp = db.query(Complaint).all()
    sev_dist    = {}
    status_dist = {}
    for c in comp:
        sev_dist[c.severity or "Unknown"] = sev_dist.get(c.severity or "Unknown", 0) + 1
        status_dist[c.status or "Unknown"] = status_dist.get(c.status or "Unknown", 0) + 1

    anomalies = []
    for r in roads:
        san = r.budget_sanctioned or 0
        sp  = r.budget_spent or 0
        if san > 0 and sp > 0 and (sp / san) < 0.65:
            anomalies.append({
                "road_id": r.road_id, "road_name": r.road_name,
                "country": r.country, "condition_label": r.condition_label,
                "utilisation_pct": round((sp / san) * 100, 1),
                "sanctioned": san, "spent": sp, "currency": r.currency,
            })

    return {
        "condition_distribution": cond_dist,
        "by_country": by_country,
        "by_road_type": by_type,
        "budget_by_country": budget_by_country,
        "complaint_severity_distribution": sev_dist,
        "complaint_status_distribution": status_dist,
        "budget_anomalies": anomalies,
        "total_roads": len(roads),
        "total_complaints": len(comp),
    }

@app.get("/api/analytics/compare")
def compare_roads(ids: str, db: Session = Depends(get_db)):
    id_list = [x.strip() for x in ids.split(",")][:4]
    result = []
    for rid in id_list:
        road = db.query(Road).filter(Road.road_id == rid).first()
        if road:
            d = road_to_dict(road)
            d["budget_utilisation_pct"] = safe_util_pct(
                road.budget_spent or 0, road.budget_sanctioned or 0)
            result.append(d)
    return result

# ── Export ─────────────────────────────────────────────────────────────────────
@app.get("/api/export/roads.csv")
def export_roads_csv(
    country: Optional[str] = None,
    road_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Export road data as a downloadable CSV."""
    query = db.query(Road)
    if country:   query = query.filter(Road.country.ilike(f"%{country}%"))
    if road_type: query = query.filter(Road.road_type.ilike(f"%{road_type}%"))
    roads = query.order_by(Road.condition_score.asc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Road ID", "Road Name", "Type", "Country", "State", "District",
        "Condition", "Score", "Length (km)", "Last Relayed", "Next Maintenance",
        "Surface", "Contractor", "Executive Engineer", "EE Email",
        "Budget Sanctioned", "Budget Spent", "Currency", "Financial Year",
        "Utilisation %", "Budget Anomaly", "Data Source"
    ])
    for r in roads:
        san = r.budget_sanctioned or 0
        sp  = r.budget_spent or 0
        util = round((sp / san) * 100, 1) if san > 0 else 0
        anomaly = "YES" if (san > 0 and sp > 0 and (sp / san) < 0.65) else "No"
        writer.writerow([
            r.road_id, r.road_name, r.road_type, r.country, r.state, r.district or "",
            r.condition_label, r.condition_score, r.total_length_km,
            r.last_relayed_date, r.next_maintenance, r.surface_type,
            r.contractor_name, r.executive_engineer, r.ee_email,
            san, sp, r.currency or "INR", r.financial_year or "",
            util, anomaly, r.data_source_label or ""
        ])

    output.seek(0)
    filename = f"roadwatch_roads_{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/export/complaints.csv")
def export_complaints_csv(
    status: Optional[str] = None,
    country: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Complaint)
    if status:  query = query.filter(Complaint.status == status)
    if country: query = query.filter(Complaint.country.ilike(f"%{country}%"))
    complaints = query.order_by(Complaint.filed_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Complaint ID", "Issue Type", "Severity", "Status", "Country", "State",
        "Location", "Citizen Name", "Phone", "Filed At",
        "Routed To", "Department", "Resolution Note"
    ])
    for c in complaints:
        writer.writerow([
            c.complaint_id, c.issue_type, c.severity, c.status,
            c.country, c.state, c.location_desc or "",
            c.citizen_name, c.phone,
            c.filed_at.isoformat() if c.filed_at else "",
            c.routed_to_name or "", c.department or "",
            c.resolution_note or ""
        ])

    output.seek(0)
    filename = f"roadwatch_complaints_{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ── Chatbot ────────────────────────────────────────────────────────────────────
@app.post("/api/chat")
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    import re as _re

    road = None

    # ── 1. Find road from explicit road_id param ─────────────────────────────
    if req.road_id:
        road = (db.query(Road).filter(Road.road_id == req.road_id).first() or
                db.query(Road).filter(Road.road_id.ilike(f"%{req.road_id}%")).first())

    # ── 2. Try to extract road ID from message text ──────────────────────────
    if not road:
        for pat in [
            r'\b(NH|SH|MDR|ODR|VR|PMGSY|PUNE-EXP|YEW)[-\s]?\w+\b',
            r'\b(M\d{1,2}|A\d{1,3}|B\d{4}|US-\d{2,3}|I-\d{2,3}|AH\d{1,2}|E\d{2}|RN\d{1,3}|N\d{1,3})\b',
            r'\b[A-Z]{2,4}-\d{1,3}-[A-Z]{2,4}\b',
        ]:
            m = _re.search(pat, req.message, _re.IGNORECASE)
            if m:
                road = db.query(Road).filter(Road.road_id.ilike(f"%{m.group(0).strip()}%")).first()
                if road:
                    break

    # ── 3. Build per-road context if found ───────────────────────────────────
    road_context = {}
    if road:
        complaints_count = db.query(Complaint).filter(Complaint.road_id == road.id).count()
        budget_history   = db.query(BudgetRecord).filter(BudgetRecord.road_id == road.id).all()
        road_context = {
            "road": road_to_dict(road),
            "complaints_count": complaints_count,
            "budget_history": [
                {"fy": b.financial_year, "work_type": b.work_type,
                 "sanctioned": b.amount_sanctioned, "spent": b.amount_spent,
                 "source": b.source_label}
                for b in budget_history
            ],
        }

    # ── 4. ALWAYS build live database summary context ────────────────────────
    all_roads = db.query(Road).all()

    # Summary stats
    total_roads     = len(all_roads)
    total_complaints= db.query(Complaint).count()
    open_complaints = db.query(Complaint).filter(Complaint.status != "Resolved").count()
    resolved        = total_complaints - open_complaints
    critical_roads  = [r for r in all_roads if r.condition_label == "Critical"]
    poor_roads      = [r for r in all_roads if r.condition_label == "Poor"]
    good_roads      = [r for r in all_roads if r.condition_label in ("Good", "Excellent")]
    countries       = sorted(set(r.country for r in all_roads if r.country))
    total_budget_s  = sum(r.budget_sanctioned or 0 for r in all_roads)
    total_budget_sp = sum(r.budget_spent     or 0 for r in all_roads)
    anomaly_roads   = [r for r in all_roads
                       if r.budget_sanctioned and r.budget_spent
                       and (r.budget_spent / r.budget_sanctioned) < 0.65]

    # Compact road list for Groq (id, name, country, condition, budget util %)
    road_list = []
    for r in all_roads:
        util = round(r.budget_spent / r.budget_sanctioned * 100, 1) \
               if r.budget_sanctioned else None
        road_list.append({
            "id":        r.road_id,
            "name":      r.road_name,
            "type":      r.road_type,
            "country":   r.country,
            "state":     r.state,
            "condition": r.condition_label,
            "score":     r.condition_score,
            "contractor":r.contractor_name,
            "ee":        r.executive_engineer,
            "ee_email":  r.ee_email,
            "ee_phone":  r.ee_phone,
            "dept":      r.department,
            "length_km": r.total_length_km,
            "last_relayed": r.last_relayed_date,
            "budget_sanctioned": r.budget_sanctioned,
            "budget_spent":      r.budget_spent,
            "budget_util_pct":   util,
            "currency":  r.currency or "INR",
            "anomaly":   util is not None and util < 65,
        })

    db_summary = {
        "total_roads":           total_roads,
        "total_complaints":      total_complaints,
        "open_complaints":       open_complaints,
        "resolved_complaints":   resolved,
        "countries":             countries,
        "countries_count":       len(countries),
        "critical_roads":        [r.road_id for r in critical_roads],
        "poor_roads":            [r.road_id for r in poor_roads],
        "good_or_excellent":     [r.road_id for r in good_roads],
        "anomaly_roads":         [r.road_id for r in anomaly_roads],
        "total_budget_sanctioned_inr": total_budget_s,
        "total_budget_spent_inr":      total_budget_sp,
        "all_roads":             road_list,
    }

    # ── 5. Merge contexts ────────────────────────────────────────────────────
    context = {**road_context, "db_summary": db_summary}

    reply = get_ai_response(req.message, context)
    return {
        "reply":        reply,
        "road_resolved": road.road_id if road else None,
    }

# ── Complaints ─────────────────────────────────────────────────────────────────
@app.post("/api/complaints")
async def file_complaint(
    citizen_name: str = Form(...), phone: str = Form(...),
    email: str = Form(""), country: str = Form("India"),
    state: str = Form(""), district: str = Form(""),
    road_id: Optional[int] = Form(None),
    road_type: str = Form("NH"), issue_type: str = Form(...),
    description: str = Form(...), severity: str = Form("Medium"),
    location_lat: Optional[float] = Form(None),
    location_lon: Optional[float] = Form(None),
    location_desc: str = Form(""),
    image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    complaint_id = f"RW-2026-{str(uuid.uuid4().int)[:5]}"
    image_path, ai_assessment = None, None

    if image and image.filename:
        ext = image.filename.rsplit(".", 1)[-1].lower()
        fpath = UPLOADS_DIR / f"{complaint_id}.{ext}"
        content = await image.read()
        with open(fpath, "wb") as f:
            f.write(content)
        image_path = str(fpath)
        assessment = assess_road_damage(content, image.filename)
        ai_assessment = json.dumps(assessment)
        score = assessment.get("severity_score", 0)
        if score >= 8:   severity = "Critical"
        elif score >= 6: severity = "High"
        elif score >= 4: severity = "Medium"
        else:            severity = "Low"

    routing = route_complaint(road_type, country, state, district=district, db_session=db)

    road_obj = db.query(Road).filter(Road.id == road_id).first() if road_id else None
    if road_obj:
        routing["name"]       = road_obj.executive_engineer or routing["name"]
        routing["email"]      = road_obj.ee_email or routing["email"]
        routing["phone"]      = road_obj.ee_phone or routing["phone"]
        routing["department"] = road_obj.department or routing["department"]

    complaint = Complaint(
        complaint_id=complaint_id, road_id=road_id,
        citizen_name=citizen_name, phone=phone, email=email,
        country=country, state=state, issue_type=issue_type,
        description=description, severity=severity,
        image_path=image_path, ai_assessment=ai_assessment,
        location_lat=location_lat, location_lon=location_lon,
        location_desc=location_desc,
        routed_to_name=routing.get("name"),
        routed_to_email=routing.get("email"),
        routed_to_phone=routing.get("phone"),
        department=routing.get("department"),
        status="Filed",
        filed_at=datetime.utcnow(), updated_at=datetime.utcnow(),
    )
    db.add(complaint)
    db.commit()
    db.refresh(complaint)

    return {
        "success": True, "complaint_id": complaint_id, "status": "Filed",
        "routed_to": routing,
        "ai_assessment": json.loads(ai_assessment) if ai_assessment else None,
        "severity": severity,
        "message": f"Complaint {complaint_id} filed. Routed to {routing.get('name')} — {routing.get('department')}.",
    }

@app.get("/api/complaints")
def list_complaints(
    status: Optional[str] = None, country: Optional[str] = None,
    severity: Optional[str] = None, road_id: Optional[int] = None,
    phone: Optional[str] = None,
    limit: int = 50, db: Session = Depends(get_db)
):
    q = db.query(Complaint)
    if status:   q = q.filter(Complaint.status == status)
    if country:  q = q.filter(Complaint.country.ilike(f"%{country}%"))
    if severity: q = q.filter(Complaint.severity == severity)
    if road_id:  q = q.filter(Complaint.road_id == road_id)
    if phone:    q = q.filter(Complaint.phone.ilike(f"%{phone}%"))
    items = q.order_by(Complaint.filed_at.desc()).limit(limit).all()
    return {"complaints": [{
        "complaint_id": c.complaint_id, "issue_type": c.issue_type,
        "severity": c.severity, "status": c.status,
        "location_lat": c.location_lat, "location_lon": c.location_lon,
        "location_desc": c.location_desc, "citizen_name": c.citizen_name,
        "filed_at": c.filed_at.isoformat() if c.filed_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "routed_to_name": c.routed_to_name, "department": c.department,
        "country": c.country, "state": c.state,
        "ai_assessment": json.loads(c.ai_assessment) if c.ai_assessment else None,
        "road_id": c.road_id,
    } for c in items]}

@app.get("/api/complaints/{complaint_id}")
def get_complaint(complaint_id: str, db: Session = Depends(get_db)):
    c = db.query(Complaint).filter(Complaint.complaint_id == complaint_id).first()
    if not c:
        raise HTTPException(404, "Complaint not found")
    return {
        "complaint_id": c.complaint_id, "issue_type": c.issue_type,
        "description": c.description, "severity": c.severity, "status": c.status,
        "citizen_name": c.citizen_name, "phone": c.phone, "email": c.email,
        "country": c.country, "state": c.state,
        "location_lat": c.location_lat, "location_lon": c.location_lon,
        "location_desc": c.location_desc,
        "routed_to_name": c.routed_to_name, "routed_to_email": c.routed_to_email,
        "routed_to_phone": c.routed_to_phone, "department": c.department,
        "filed_at": c.filed_at.isoformat() if c.filed_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "resolved_at": c.resolved_at.isoformat() if c.resolved_at else None,
        "ai_assessment": json.loads(c.ai_assessment) if c.ai_assessment else None,
        "resolution_note": c.resolution_note,
    }

@app.patch("/api/complaints/{complaint_id}/status")
def update_complaint_status(complaint_id: str, body: ComplaintStatusUpdate,
                             db: Session = Depends(get_db)):
    c = db.query(Complaint).filter(Complaint.complaint_id == complaint_id).first()
    if not c: raise HTTPException(404, "Complaint not found")
    c.status = body.status
    c.updated_at = datetime.utcnow()
    if body.resolution_note: c.resolution_note = body.resolution_note
    if body.status in ("Resolved", "Closed"): c.resolved_at = datetime.utcnow()
    db.commit()
    return {"success": True, "complaint_id": complaint_id, "new_status": body.status}

@app.get("/api/roads/{road_id_str}/complaints")
def road_complaints(road_id_str: str, db: Session = Depends(get_db)):
    road = db.query(Road).filter(Road.road_id == road_id_str).first()
    if not road: raise HTTPException(404, "Road not found")
    items = db.query(Complaint).filter(Complaint.road_id == road.id)\
               .order_by(Complaint.filed_at.desc()).all()
    return {"complaints": [{
        "complaint_id": c.complaint_id, "issue_type": c.issue_type,
        "severity": c.severity, "status": c.status,
        "description": c.description, "location_desc": c.location_desc,
        "filed_at": c.filed_at.isoformat() if c.filed_at else None,
        "ai_assessment": json.loads(c.ai_assessment) if c.ai_assessment else None,
    } for c in items]}

# ── Stats ──────────────────────────────────────────────────────────────────────
@app.get("/api/stats")
def stats(db: Session = Depends(get_db)):
    total_roads      = db.query(Road).count()
    total_complaints = db.query(Complaint).count()
    open_complaints  = db.query(Complaint).filter(
        Complaint.status.in_(["Filed", "Acknowledged", "In Progress"])).count()
    countries        = db.query(Road.country).distinct().count()
    critical_roads   = db.query(Road).filter(Road.condition_label == "Critical").count()
    poor_roads       = db.query(Road).filter(Road.condition_label == "Poor").count()

    row = db.query(func.sum(Road.budget_sanctioned), func.sum(Road.budget_spent)).first()
    san, sp = (row[0] or 0), (row[1] or 0)

    # Safe Python-side anomaly count
    all_roads = db.query(Road).all()
    anomalies = sum(
        1 for r in all_roads
        if (r.budget_sanctioned or 0) > 0
        and (r.budget_spent or 0) > 0
        and ((r.budget_spent or 0) / (r.budget_sanctioned or 1)) < 0.65
    )

    return {
        "total_roads": total_roads,
        "total_complaints": total_complaints,
        "open_complaints": open_complaints,
        "countries_covered": countries,
        "critical_roads": critical_roads,
        "poor_roads": poor_roads,
        "total_budget_sanctioned": san,
        "total_budget_spent": sp,
        "avg_utilisation_pct": round((sp / san * 100), 1) if san else 0,
        "budget_anomalies": anomalies,
        "total_length_km": round(sum(r.total_length_km or 0 for r in all_roads), 1),
        "resolution_rate_pct": round(
            (db.query(Complaint).filter(Complaint.status.in_(["Resolved", "Closed"])).count()
             / total_complaints * 100), 1
        ) if total_complaints else 0,
    }

# ── Authorities ────────────────────────────────────────────────────────────────
@app.get("/api/authorities")
def find_authority(country: str = "India", road_type: str = "NH",
                   state: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Authority).filter(
        Authority.country.ilike(f"%{country}%"),
        Authority.road_type.ilike(f"%{road_type}%"),
    )
    if state: q = q.filter(Authority.state.ilike(f"%{state}%"))
    return [{"name": a.name, "designation": a.designation, "department": a.department,
             "email": a.email, "phone": a.phone, "office_address": a.office_address,
             "road_type": a.road_type, "state": a.state, "country": a.country}
            for a in q.all()]

@app.get("/api/authorities/all")
def all_authorities(country: Optional[str] = None, road_type: Optional[str] = None,
                    db: Session = Depends(get_db)):
    q = db.query(Authority)
    if country:   q = q.filter(Authority.country.ilike(f"%{country}%"))
    if road_type: q = q.filter(Authority.road_type.ilike(f"%{road_type}%"))
    return [{"name": a.name, "designation": a.designation, "department": a.department,
             "email": a.email, "phone": a.phone, "office_address": a.office_address,
             "road_type": a.road_type, "state": a.state, "country": a.country}
            for a in q.all()]

# ── Leaderboard ────────────────────────────────────────────────────────────────
@app.get("/api/leaderboard")
def leaderboard(db: Session = Depends(get_db)):
    roads = db.query(Road).all()
    # Worst 5 - lowest condition score
    worst = sorted(roads, key=lambda r: r.condition_score or 10)[:5]
    # Best 5 - highest condition score
    best = sorted(roads, key=lambda r: r.condition_score or 0, reverse=True)[:5]
    # Most complaints
    complaint_counts = {}
    for r in roads:
        cc = db.query(Complaint).filter(Complaint.road_id == r.id).count()
        complaint_counts[r.id] = cc
    most_complained = sorted(roads, key=lambda r: complaint_counts.get(r.id, 0), reverse=True)[:5]
    # Highest budget
    highest_budget = sorted(roads, key=lambda r: r.budget_sanctioned or 0, reverse=True)[:5]

    def rd(r):
        d = road_to_dict(r)
        d["budget_utilisation_pct"] = safe_util_pct(r.budget_spent or 0, r.budget_sanctioned or 0)
        d["budget_anomaly"] = bool((r.budget_sanctioned or 0) > 0 and (r.budget_spent or 0) > 0 and (r.budget_spent / r.budget_sanctioned) < 0.65)
        d["complaint_count"] = complaint_counts.get(r.id, 0)
        return d

    return {
        "worst_condition": [rd(r) for r in worst],
        "best_condition": [rd(r) for r in best],
        "most_complained": [rd(r) for r in most_complained],
        "highest_budget": [rd(r) for r in highest_budget],
    }

# ── Dashboard Summary ──────────────────────────────────────────────────────────
@app.get("/api/dashboard/summary")
def dashboard_summary(db: Session = Depends(get_db)):
    roads = db.query(Road).all()
    complaints = db.query(Complaint).all()
    total_sanctioned = sum(r.budget_sanctioned or 0 for r in roads if r.currency == "INR")
    total_spent = sum(r.budget_spent or 0 for r in roads if r.currency == "INR")
    anomaly_count = sum(1 for r in roads if (r.budget_sanctioned or 0) > 0 and (r.budget_spent or 0) > 0 and (r.budget_spent / r.budget_sanctioned) < 0.65)
    resolved = sum(1 for c in complaints if c.status in ("Resolved", "Closed"))
    return {
        "total_roads": len(roads),
        "total_complaints": len(complaints),
        "open_complaints": sum(1 for c in complaints if c.status not in ("Resolved", "Closed")),
        "resolved_complaints": resolved,
        "countries_covered": len(set(r.country for r in roads)),
        "critical_roads": sum(1 for r in roads if r.condition_label == "Critical"),
        "poor_roads": sum(1 for r in roads if r.condition_label == "Poor"),
        "good_excellent_roads": sum(1 for r in roads if r.condition_label in ("Good", "Excellent")),
        "budget_anomalies": anomaly_count,
        "total_length_km": round(sum(r.total_length_km or 0 for r in roads), 1),
        "india_budget_sanctioned_cr": round(total_sanctioned / 1e7, 1),
        "india_budget_spent_cr": round(total_spent / 1e7, 1),
        "resolution_rate_pct": round((resolved / len(complaints) * 100), 1) if complaints else 0,
    }

# ── Unified Search ─────────────────────────────────────────────────────────────
@app.get("/api/search")
def unified_search(q: str, db: Session = Depends(get_db)):
    if not q or len(q) < 2:
        return {"roads": [], "complaints": []}
    roads = db.query(Road).filter(or_(
        Road.road_id.ilike(f"%{q}%"), Road.road_name.ilike(f"%{q}%"),
        Road.state.ilike(f"%{q}%"), Road.country.ilike(f"%{q}%"),
        Road.district.ilike(f"%{q}%"), Road.contractor_name.ilike(f"%{q}%")
    )).limit(5).all()
    complaints = db.query(Complaint).filter(or_(
        Complaint.complaint_id.ilike(f"%{q}%"),
        Complaint.citizen_name.ilike(f"%{q}%"),
        Complaint.location_desc.ilike(f"%{q}%"),
    )).limit(5).all()
    return {
        "roads": [{"road_id": r.road_id, "road_name": r.road_name, "condition_label": r.condition_label, "country": r.country, "state": r.state} for r in roads],
        "complaints": [{"complaint_id": c.complaint_id, "issue_type": c.issue_type, "status": c.status, "location_desc": c.location_desc} for c in complaints],
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
