"""
RoadWatch — Database models and setup (SQLite via SQLAlchemy)
"""

from sqlalchemy import (
    create_engine, Column, Integer, String, Float, Text,
    DateTime, Boolean, ForeignKey
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# On Vercel the filesystem is read-only except /tmp
if os.getenv("VERCEL") or os.getenv("VERCEL_ENV"):
    DB_PATH = "/tmp/roadwatch.db"
else:
    DB_PATH = os.path.join(BASE_DIR, "..", "data", "roadwatch.db")
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Road master table ──────────────────────────────────────────────────────────
class Road(Base):
    __tablename__ = "roads"

    id = Column(Integer, primary_key=True, index=True)
    road_id         = Column(String, unique=True, index=True)   # e.g. "NH-44"
    road_name       = Column(String, index=True)                # e.g. "Srinagar–Kanyakumari Highway"
    road_type       = Column(String)                            # NH / SH / MDR / ODR / VR / Expressway
    country         = Column(String, default="India")
    state           = Column(String)
    district        = Column(String)

    # Contractor & responsibility
    contractor_name    = Column(String)
    contractor_contact = Column(String)
    executive_engineer = Column(String)
    ee_email           = Column(String)
    ee_phone           = Column(String)
    department         = Column(String)  # NHAI / PWD / Municipal / State Highway Dept

    # Physical details
    total_length_km  = Column(Float)
    construction_date = Column(String)
    last_relayed_date = Column(String)
    next_maintenance  = Column(String)
    surface_type      = Column(String)   # Bituminous / Cement / WBM

    # Condition
    condition_score   = Column(Float)    # 1–10
    condition_label   = Column(String)   # Excellent / Good / Fair / Poor / Critical

    # Budget
    budget_sanctioned  = Column(Float)
    budget_spent       = Column(Float)
    currency           = Column(String, default="INR")
    financial_year     = Column(String)
    data_source        = Column(String)  # URL or document reference
    data_source_label  = Column(String)

    # Location (bounding box for simplicity)
    lat_start = Column(Float)
    lon_start = Column(Float)
    lat_end   = Column(Float)
    lon_end   = Column(Float)
    lat_center = Column(Float)
    lon_center = Column(Float)

    created_at = Column(DateTime, default=datetime.utcnow)

    complaints     = relationship("Complaint", back_populates="road")
    budget_records = relationship("BudgetRecord", back_populates="road")


# ── Budget history table ───────────────────────────────────────────────────────
class BudgetRecord(Base):
    __tablename__ = "budget_records"

    id = Column(Integer, primary_key=True, index=True)
    road_id       = Column(Integer, ForeignKey("roads.id"))
    financial_year = Column(String)
    work_type      = Column(String)    # Construction / Maintenance / Repair / Widening
    amount_sanctioned = Column(Float)
    amount_spent   = Column(Float)
    currency       = Column(String, default="INR")
    contractor     = Column(String)
    work_start     = Column(String)
    work_end       = Column(String)
    source_url     = Column(String)
    source_label   = Column(String)
    verified       = Column(Boolean, default=True)

    road = relationship("Road", back_populates="budget_records")


# ── Complaint / Issue table ────────────────────────────────────────────────────
class Complaint(Base):
    __tablename__ = "complaints"

    id = Column(Integer, primary_key=True, index=True)
    complaint_id   = Column(String, unique=True, index=True)   # e.g. "RW-2026-00042"
    road_id        = Column(Integer, ForeignKey("roads.id"), nullable=True)

    # Filer details
    citizen_name   = Column(String)
    phone          = Column(String)
    email          = Column(String)
    country        = Column(String, default="India")
    state          = Column(String)

    # Issue
    issue_type     = Column(String)   # Pothole / Crack / Missing Marking / Broken Barrier / Flooding / Other
    description    = Column(Text)
    severity       = Column(String)   # Low / Medium / High / Critical
    image_path     = Column(String)
    ai_assessment  = Column(Text)     # JSON: {damage_type, confidence, severity_score}

    # Location
    location_lat   = Column(Float)
    location_lon   = Column(Float)
    location_desc  = Column(String)

    # Routing
    routed_to_name  = Column(String)
    routed_to_email = Column(String)
    routed_to_phone = Column(String)
    department      = Column(String)

    # Status
    status         = Column(String, default="Filed")   # Filed / Acknowledged / In Progress / Resolved / Closed
    resolution_note = Column(Text)

    filed_at       = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow)
    resolved_at    = Column(DateTime, nullable=True)

    road = relationship("Road", back_populates="complaints")


# ── Authority / Executive Engineer directory ───────────────────────────────────
class Authority(Base):
    __tablename__ = "authorities"

    id = Column(Integer, primary_key=True, index=True)
    country    = Column(String)
    state      = Column(String)
    district   = Column(String, nullable=True)
    road_type  = Column(String)          # NH / SH / MDR / etc.
    department = Column(String)
    name       = Column(String)
    designation = Column(String)         # Executive Engineer / Divisional Engineer / etc.
    email      = Column(String)
    phone      = Column(String)
    office_address = Column(String)


def create_tables():
    Base.metadata.create_all(bind=engine)
