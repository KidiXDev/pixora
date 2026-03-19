"""Top-level package for pixorabridge."""

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
]

WEB_DIRECTORY = "./web"

__author__ = """KidiXDev"""
__email__ = "kidixdev@logiclab.id"
__version__ = "0.0.1"

from .src.pixorabridge.nodes import NODE_CLASS_MAPPINGS
from .src.pixorabridge.nodes import NODE_DISPLAY_NAME_MAPPINGS
