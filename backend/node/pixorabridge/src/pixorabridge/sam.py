import importlib
import os
import subprocess
import sys

import torch

try:
    import folder_paths  # type: ignore
except Exception:
    folder_paths = None


def _resolve_sam_roots() -> tuple[str, str]:
    here = os.path.abspath(os.path.dirname(__file__))
    comfy_root = os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
    runtime_root = os.path.abspath(os.path.join(comfy_root, "..", "..", ".."))
    return comfy_root, runtime_root


def _register_sams_model_paths() -> None:
    if folder_paths is None:
        return

    comfy_root, runtime_root = _resolve_sam_roots()
    candidate_roots = [
        os.path.join(runtime_root, "data", "sd", "sams"),
        os.path.join(comfy_root, "models", "sams"),
    ]

    for index, path in enumerate(candidate_roots):
        if not os.path.isdir(path):
            continue
        try:
            folder_paths.add_model_folder_path("sams", os.path.normpath(path), is_default=index == 0)
        except Exception:
            continue


def resolve_sam_model_path(sam_model_name: str) -> str:
    name = str(sam_model_name or "").strip()
    if name == "":
        return ""

    _register_sams_model_paths()

    if os.path.isabs(name):
        return os.path.normpath(name)

    if folder_paths is not None:
        try:
            resolved = folder_paths.get_full_path("sams", name)
            if resolved and os.path.isfile(resolved):
                return os.path.normpath(resolved)
        except Exception:
            pass

        try:
            basename = os.path.basename(name)
            if basename:
                available = folder_paths.get_filename_list("sams")
                lowered = basename.lower()
                matches = [entry for entry in available if os.path.basename(str(entry)).lower() == lowered]
                if len(matches) == 1:
                    resolved = folder_paths.get_full_path("sams", matches[0])
                    if resolved and os.path.isfile(resolved):
                        return os.path.normpath(resolved)
        except Exception:
            pass

    cwd = os.getcwd()

    comfy_root, runtime_root = _resolve_sam_roots()

    base_name = os.path.basename(name)

    candidates = [
        os.path.join(comfy_root, "models", "sams", name),
        os.path.join(comfy_root, "models", "sams", base_name),
        os.path.join(runtime_root, "data", "sd", "sams", name),
        os.path.join(runtime_root, "data", "sd", "sams", base_name),
        os.path.join(cwd, "models", "sams", name),
        os.path.join(cwd, "models", "sams", base_name),
        os.path.join(cwd, "data", "sd", "sams", name),
        os.path.join(cwd, "data", "sd", "sams", base_name),
        os.path.join(cwd, "data", "sd", name),
        os.path.join(cwd, "data", "sd", base_name),
        os.path.join(cwd, "..", "models", "sams", name),
        os.path.join(cwd, "..", "models", "sams", base_name),
        os.path.join(cwd, "..", "..", "..", "data", "sd", "sams", name),
        os.path.join(cwd, "..", "..", "..", "data", "sd", "sams", base_name),
        os.path.join(cwd, "..", "..", "..", "models", "sams", name),
        os.path.join(cwd, "..", "..", "..", "models", "sams", base_name),
    ]

    for candidate in candidates:
        normalized = os.path.abspath(candidate)
        if os.path.isfile(normalized):
            return normalized

    return os.path.abspath(name)


class PixoraSAMModelWrapper:
    def __init__(self, model_path):
        self.model_path = model_path
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.predictor = None
        self.sam_wrapper = self

    def _ensure_segment_anything(self):
        try:
            return importlib.import_module("segment_anything")
        except Exception:
            pass

        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "segment-anything"],
                check=True,
                capture_output=True,
                text=True,
            )
            return importlib.import_module("segment_anything")
        except Exception as exc:
            raise RuntimeError(
                "SAM support requires 'segment-anything'. Automatic installation failed. "
                "Install it manually in ComfyUI Python environment."
            ) from exc

    @staticmethod
    def _infer_model_type(model_path):
        name = os.path.basename(model_path).lower()
        if "vit_h" in name:
            return "vit_h"
        if "vit_l" in name:
            return "vit_l"
        if "vit_b" in name:
            return "vit_b"
        raise RuntimeError(
            f"Unable to infer SAM model type from filename '{name}'. Include vit_h, vit_l, or vit_b in filename."
        )

    def _ensure_loaded(self):
        if self.predictor is not None:
            return

        sam_module = self._ensure_segment_anything()
        model_type = self._infer_model_type(self.model_path)
        sam_registry = sam_module.sam_model_registry
        sam_predictor = sam_module.SamPredictor
        model = sam_registry[model_type](checkpoint=self.model_path)
        model.to(device=self.device)
        self.predictor = sam_predictor(model)

    def prepare_device(self):
        self._ensure_loaded()

    def release_device(self):
        if self.predictor is None:
            return
        if torch.cuda.is_available() and self.device != "cpu":
            self.predictor.model.to(device="cpu")

    def predict(self, image, points, plabs, bbox, threshold):
        self._ensure_loaded()
        self.predictor.set_image(image)

        import numpy as np

        point_coords = np.array(points, dtype=np.float32) if len(points) > 0 else None
        point_labels = np.array(plabs, dtype=np.int32) if point_coords is not None else None
        box = np.array(bbox, dtype=np.float32) if bbox is not None else None

        masks, scores, _ = self.predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            box=box,
            multimask_output=True,
        )

        selected = []
        for idx, mask in enumerate(masks):
            if idx < len(scores) and scores[idx] >= threshold:
                selected.append(mask.astype(np.uint8))

        if len(selected) == 0 and len(masks) > 0:
            best_idx = int(np.argmax(scores))
            selected = [masks[best_idx].astype(np.uint8)]

        return selected


class PixoraLoadSAMModel:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "sam_model_name": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": "SAM checkpoint absolute path, Comfy sams model name, or filename under model directories (expects .pth).",
                    },
                ),
            }
        }

    RETURN_TYPES = ("SAM_MODEL",)
    FUNCTION = "load_model"
    CATEGORY = "Pixora"

    def load_model(self, sam_model_name):
        resolved_path = resolve_sam_model_path(sam_model_name)
        if not resolved_path or not os.path.isfile(resolved_path):
            raise RuntimeError(
                f"SAM model '{sam_model_name}' not found. Expected a valid Comfy 'sams' model entry, absolute path, or file under Pixora/Comfy model roots with .pth format."
            )
        if os.path.splitext(resolved_path)[1].lower() != ".pth":
            raise RuntimeError(f"Invalid SAM model '{resolved_path}'. Expected .pth file.")
        return (PixoraSAMModelWrapper(resolved_path),)
