import sys
import os

# Make backend importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.main import app
