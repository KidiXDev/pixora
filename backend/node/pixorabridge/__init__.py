"""Top-level package for pixorabridge."""

from __future__ import annotations

import importlib
import subprocess
import sys
import warnings

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
]

WEB_DIRECTORY = "./web"

__author__ = """KidiXDev"""
__email__ = "kidixdev@logiclab.id"
__version__ = "0.0.1"


_PIP_INSTALL_OVERRIDES = {"ultralytics": ["--no-deps"]}


def _ensure_pip_available() -> None:
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "--version"],
            check=True,
            capture_output=True,
            text=True,
        )
        return
    except Exception:
        pass

    subprocess.run(
        [sys.executable, "-m", "ensurepip", "--upgrade"],
        check=True,
        capture_output=True,
        text=True,
    )


def _ensure_python_dependency(module_name: str, pip_package: str) -> None:
    try:
        importlib.import_module(module_name)
        return
    except Exception:
        pass

    try:
        _ensure_pip_available()

        install_command = [
            sys.executable,
            "-m",
            "pip",
            "install",
            pip_package,
            *(_PIP_INSTALL_OVERRIDES.get(pip_package, [])),
        ]
        subprocess.run(
            install_command,
            check=True,
            capture_output=True,
            text=True,
        )
        importlib.import_module(module_name)
    except Exception as exc:
        detail = ""
        if isinstance(exc, subprocess.CalledProcessError):
            stderr = (exc.stderr or "").strip()
            stdout = (exc.stdout or "").strip()
            tail = stderr or stdout
            if tail:
                detail = f" Output: {tail[-300:]}"
        warnings.warn(
            f"pixorabridge: failed to auto-install optional dependency '{pip_package}' ({exc}). "
            f"Some nodes may be unavailable.{detail}",
            RuntimeWarning,
            stacklevel=2,
        )


_ensure_python_dependency("cv2", "opencv-python-headless")
_ensure_python_dependency("ultralytics", "ultralytics")

from .src.pixorabridge.nodes import NODE_CLASS_MAPPINGS
from .src.pixorabridge.nodes import NODE_DISPLAY_NAME_MAPPINGS
