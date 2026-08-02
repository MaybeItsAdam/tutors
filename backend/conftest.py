import os
import sys

# The backend modules import each other flat (`from utils import ...`), matching
# how uvicorn runs them from inside this directory. Put that directory on the
# path so tests import the same way the app does.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
