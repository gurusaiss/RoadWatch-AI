import sys
import os

# backend/main.py uses bare imports (from database import ..., from ai_engine import ...)
# Add backend/ to sys.path so all those bare imports resolve correctly.
_backend = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if _backend not in sys.path:
    sys.path.insert(0, _backend)

# Import the FastAPI app from main.py directly (no package prefix needed)
from main import app  # noqa: E402  — Vercel ASGI entry-point
