import os
from collections import namedtuple

import comfy.samplers
import numpy as np
import torch

try:
    import folder_paths  # type: ignore
except Exception:
    folder_paths = None

try:
    import cv2
except Exception:
    cv2 = None

try:
    from ultralytics import YOLO
except Exception:
    YOLO = None

from .core import PixoraCore
from .sam import PixoraLoadSAMModel

try:
    import nodes as comfy_nodes

    MAX_RESOLUTION = comfy_nodes.MAX_RESOLUTION
except Exception:
    MAX_RESOLUTION = 16384


SEG = namedtuple(
    "SEG",
    ["cropped_image", "cropped_mask", "confidence", "crop_region", "bbox", "label", "control_net_wrapper"],
    defaults=[None],
)


class PixoraUltralyticsFaceDetector:
    def __init__(self, model_path):
        if YOLO is None:
            raise RuntimeError(
                "PixoraFaceBBoxDetectorProvider requires ultralytics. Install dependency 'ultralytics'."
            )
        if not os.path.isfile(model_path):
            raise RuntimeError(f"BBOX model not found: {model_path}")

        self._aux = None
        self.model_path = model_path
        try:
            self.model = YOLO(model_path)
        except Exception as exc:
            raise RuntimeError(f"Failed to load bbox model '{model_path}': {exc}") from exc

    @staticmethod
    def _normalize_region(limit, startp, size):
        if startp < 0:
            new_endp = min(limit, size)
            new_startp = 0
        elif startp + size > limit:
            new_startp = max(0, limit - size)
            new_endp = limit
        else:
            new_startp = startp
            new_endp = min(limit, startp + size)
        return int(new_startp), int(new_endp)

    @classmethod
    def _make_crop_region(cls, w, h, bbox, crop_factor):
        x1, y1, x2, y2 = bbox
        bbox_w = x2 - x1
        bbox_h = y2 - y1
        crop_w = bbox_w * crop_factor
        crop_h = bbox_h * crop_factor
        kernel_x = x1 + bbox_w / 2
        kernel_y = y1 + bbox_h / 2
        new_x1 = int(kernel_x - crop_w / 2)
        new_y1 = int(kernel_y - crop_h / 2)
        new_x1, new_x2 = cls._normalize_region(w, new_x1, crop_w)
        new_y1, new_y2 = cls._normalize_region(h, new_y1, crop_h)
        return [new_x1, new_y1, new_x2, new_y2]

    @staticmethod
    def _dilate_mask(mask, dilation_factor):
        if dilation_factor == 0 or cv2 is None:
            return mask
        kernel = np.ones((abs(dilation_factor), abs(dilation_factor)), np.uint8)
        if dilation_factor > 0:
            return cv2.dilate(mask, kernel, 1)
        return cv2.erode(mask, kernel, 1)

    def setAux(self, x):
        self._aux = x

    def detect(self, image, threshold, dilation, crop_factor, drop_size=1, detailer_hook=None):
        if len(image) > 1:
            raise Exception("PixoraOpenCVFaceDetector does not allow image batches")

        drop_size = max(1, int(drop_size))
        frame = np.clip(255.0 * image[0].cpu().numpy(), 0, 255).astype(np.uint8)
        h, w, _ = frame.shape
        conf = float(min(max(threshold, 0.0), 1.0))
        try:
            results = self.model.predict(source=frame, conf=conf, verbose=False)
        except Exception as exc:
            raise RuntimeError(f"Failed running bbox model '{self.model_path}': {exc}") from exc

        faces = []
        for result in results:
            boxes = getattr(result, "boxes", None)
            if boxes is None or boxes.xyxy is None:
                continue
            for xyxy in boxes.xyxy.cpu().numpy().tolist():
                x1, y1, x2, y2 = [int(v) for v in xyxy]
                fw, fh = x2 - x1, y2 - y1
                faces.append((x1, y1, fw, fh))

        result = []
        for (x, y, fw, fh) in faces:
            x1, y1, x2, y2 = int(x), int(y), int(x + fw), int(y + fh)
            if fw <= drop_size or fh <= drop_size:
                continue

            bbox = (x1, y1, x2, y2)
            crop_region = self._make_crop_region(w, h, bbox, crop_factor)
            cx1, cy1, cx2, cy2 = crop_region

            cropped_mask = np.zeros((cy2 - cy1, cx2 - cx1), dtype=np.float32)
            cropped_mask[y1 - cy1 : y2 - cy1, x1 - cx1 : x2 - cx1] = 1.0
            mask_u8 = (cropped_mask * 255).astype(np.uint8)
            mask_u8 = self._dilate_mask(mask_u8, int(dilation))
            cropped_mask = mask_u8.astype(np.float32) / 255.0

            result.append(SEG(None, cropped_mask, 1.0, crop_region, bbox, str(self._aux or "face"), None))

        return ((h, w), result)

    def detect_combined(self, image, threshold, dilation):
        segs = self.detect(image, threshold, dilation, 1.0, 1)
        return PixoraFaceDetailer.segs_to_combined_mask(segs)


class PixoraFaceBBoxDetectorProvider:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bbox_model_name": (
                    "STRING",
                    {
                        "default": "bbox/face_yolov8m.pt",
                        "tooltip": "BBOX model filename/path. Relative paths are resolved from data/sd.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("BBOX_DETECTOR",)
    FUNCTION = "load_detector"
    CATEGORY = "Pixora"

    @staticmethod
    def _resolve_bbox_roots():
        here = os.path.abspath(os.path.dirname(__file__))
        comfy_root = os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
        runtime_root = os.path.abspath(os.path.join(comfy_root, "..", "..", ".."))
        return comfy_root, runtime_root

    @classmethod
    def _register_bbox_model_paths(cls):
        if folder_paths is None:
            return

        comfy_root, runtime_root = cls._resolve_bbox_roots()
        candidate_roots = [
            os.path.join(runtime_root, "data", "sd", "bbox"),
            os.path.join(comfy_root, "models", "bbox"),
        ]

        for index, path in enumerate(candidate_roots):
            if not os.path.isdir(path):
                continue
            try:
                folder_paths.add_model_folder_path("bbox", os.path.normpath(path), is_default=index == 0)
            except Exception:
                continue

    @classmethod
    def _resolve_bbox_model_path(cls, model_name):
        name = str(model_name or "").strip()
        if not name:
            raise RuntimeError("bbox_model_name is required")
        if os.path.isabs(name):
            return os.path.normpath(name)

        cls._register_bbox_model_paths()

        if folder_paths is not None:
            try:
                resolved = folder_paths.get_full_path("bbox", name)
                if resolved and os.path.isfile(resolved):
                    return os.path.normpath(resolved)
            except Exception:
                pass

            try:
                base_name = os.path.basename(name)
                if base_name:
                    available = folder_paths.get_filename_list("bbox")
                    lowered = base_name.lower()
                    matches = [entry for entry in available if os.path.basename(str(entry)).lower() == lowered]
                    if len(matches) == 1:
                        resolved = folder_paths.get_full_path("bbox", matches[0])
                        if resolved and os.path.isfile(resolved):
                            return os.path.normpath(resolved)
            except Exception:
                pass

        cwd = os.getcwd()
        comfy_root, runtime_root = cls._resolve_bbox_roots()
        base_name = os.path.basename(name)

        candidates = [
            os.path.join(runtime_root, "data", "sd", "bbox", name),
            os.path.join(runtime_root, "data", "sd", "bbox", base_name),
            os.path.join(comfy_root, "models", "bbox", name),
            os.path.join(comfy_root, "models", "bbox", base_name),
            os.path.join(cwd, "data", "sd", name),
            os.path.join(cwd, "data", "sd", "bbox", name),
            os.path.join(cwd, "data", "sd", "bbox", base_name),
            os.path.join(cwd, "..", "..", "..", "data", "sd", name),
            os.path.join(cwd, "..", "..", "..", "data", "sd", "bbox", name),
            os.path.join(cwd, "..", "..", "..", "data", "sd", "bbox", base_name),
        ]
        for candidate in candidates:
            normalized = os.path.abspath(candidate)
            if os.path.isfile(normalized):
                return normalized
        return os.path.abspath(name)

    def load_detector(self, bbox_model_name):
        resolved_path = self._resolve_bbox_model_path(bbox_model_name)
        if not os.path.isfile(resolved_path):
            raise RuntimeError(
                f"BBOX model '{bbox_model_name}' not found. Expected a valid bbox model entry, absolute path, or file under Pixora/Comfy bbox model roots."
            )
        ext = os.path.splitext(resolved_path)[1].lower()
        if ext not in (".pt", ".onnx"):
            raise RuntimeError(f"Invalid bbox model '{resolved_path}'. Expected .pt or .onnx file.")
        return (PixoraUltralyticsFaceDetector(resolved_path),)


class PixoraFaceDetailer(PixoraCore):
    _sam_model_cache = {}

    @staticmethod
    def _scheduler_options():
        return list(comfy.samplers.SCHEDULER_HANDLERS)

    @classmethod
    def _load_sam_model(cls, sam_model_name):
        loader = PixoraLoadSAMModel()
        return loader.load_model(sam_model_name)[0]

    @classmethod
    def segs_to_combined_mask(cls, segs):
        h, w = segs[0]
        if len(segs[1]) == 0:
            return torch.zeros((1, h, w), dtype=torch.float32, device="cpu")
        merged = np.zeros((h, w), dtype=np.float32)
        for seg in segs[1]:
            x1, y1, x2, y2 = seg.crop_region
            mask = seg.cropped_mask
            if isinstance(mask, torch.Tensor):
                mask = mask.cpu().numpy()
            if len(mask.shape) == 3:
                mask = mask.max(axis=0)
            region = merged[y1:y2, x1:x2]
            np.maximum(region, mask.astype(np.float32), out=region)
        return torch.from_numpy(merged).unsqueeze(0)

    @classmethod
    def segs_bitwise_and_mask(cls, segs, mask):
        mask2d = cls.make_2d_mask(mask)
        if mask2d is None:
            return segs
        mask_u8 = (mask2d.cpu().numpy() * 255).astype(np.uint8)
        items = []
        for seg in segs[1]:
            cropped_mask = (seg.cropped_mask * 255).astype(np.uint8)
            x1, y1, x2, y2 = seg.crop_region
            sliced = mask_u8[y1:y2, x1:x2]
            new_mask = np.bitwise_and(cropped_mask, sliced).astype(np.float32) / 255.0
            items.append(SEG(seg.cropped_image, new_mask, seg.confidence, seg.crop_region, seg.bbox, seg.label, seg.control_net_wrapper))
        return (segs[0], items)

    @staticmethod
    def _center_of_bbox(bbox):
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        return bbox[0] + w / 2, bbox[1] + h / 2

    @classmethod
    def _gen_detection_hints_from_mask_area(cls, x, y, mask, threshold, use_negative):
        mask = cls.make_2d_mask(mask)
        points = []
        plabs = []
        y_step = max(3, int(mask.shape[0] / 20))
        x_step = max(3, int(mask.shape[1] / 20))
        for i in range(0, len(mask), y_step):
            for j in range(0, len(mask[i]), x_step):
                if mask[i][j] > threshold:
                    points.append((x + j, y + i))
                    plabs.append(1)
                elif use_negative and mask[i][j] == 0:
                    points.append((x + j, y + i))
                    plabs.append(0)
        return points, plabs

    @staticmethod
    def _gen_negative_hints(w, h, x1, y1, x2, y2):
        npoints = []
        nplabs = []
        y_step = max(3, int(w / 20))
        x_step = max(3, int(h / 20))
        for i in range(10, h - 10, y_step):
            for j in range(10, w - 10, x_step):
                if not (x1 - 10 <= j <= x2 + 10 and y1 - 10 <= i <= y2 + 10):
                    npoints.append((j, i))
                    nplabs.append(0)
        return npoints, nplabs

    @classmethod
    def _make_sam_mask(
        cls,
        sam_model,
        segs,
        image,
        detection_hint,
        dilation,
        threshold,
        bbox_expansion,
        mask_hint_threshold,
        mask_hint_use_negative,
    ):
        sam_obj = sam_model.sam_wrapper if hasattr(sam_model, "sam_wrapper") else sam_model
        prepare = getattr(sam_obj, "prepare_device", None)
        release = getattr(sam_obj, "release_device", None)
        if callable(prepare):
            prepare()

        try:
            image_np = np.clip(255.0 * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)
            total_masks = []
            use_small_negative = mask_hint_use_negative == "Small"
            seg_items = segs[1]

            if detection_hint == "mask-points":
                points = []
                plabs = []
                for seg in seg_items:
                    bbox = seg.bbox
                    points.append(cls._center_of_bbox(bbox))
                    plabs.append(0 if use_small_negative and bbox[2] - bbox[0] < 10 else 1)
                total_masks += sam_obj.predict(image_np, points, plabs, None, threshold)
            else:
                for seg in seg_items:
                    bbox = seg.bbox
                    center = cls._center_of_bbox(bbox)
                    x1 = max(bbox[0] - bbox_expansion, 0)
                    y1 = max(bbox[1] - bbox_expansion, 0)
                    x2 = min(bbox[2] + bbox_expansion, image_np.shape[1])
                    y2 = min(bbox[3] + bbox_expansion, image_np.shape[0])
                    dilated_bbox = [x1, y1, x2, y2]

                    points = []
                    plabs = []
                    if detection_hint == "center-1":
                        points, plabs = [center], [1]
                    elif detection_hint == "horizontal-2":
                        gap = (x2 - x1) / 3
                        points = [(x1 + gap, center[1]), (x1 + gap * 2, center[1])]
                        plabs = [1, 1]
                    elif detection_hint == "vertical-2":
                        gap = (y2 - y1) / 3
                        points = [(center[0], y1 + gap), (center[0], y1 + gap * 2)]
                        plabs = [1, 1]
                    elif detection_hint == "rect-4":
                        x_gap = (x2 - x1) / 3
                        y_gap = (y2 - y1) / 3
                        points = [(x1 + x_gap, center[1]), (x1 + x_gap * 2, center[1]), (center[0], y1 + y_gap), (center[0], y1 + y_gap * 2)]
                        plabs = [1, 1, 1, 1]
                    elif detection_hint == "diamond-4":
                        x_gap = (x2 - x1) / 3
                        y_gap = (y2 - y1) / 3
                        points = [(x1 + x_gap, y1 + y_gap), (x1 + x_gap * 2, y1 + y_gap), (x1 + x_gap, y1 + y_gap * 2), (x1 + x_gap * 2, y1 + y_gap * 2)]
                        plabs = [1, 1, 1, 1]
                    elif detection_hint == "mask-point-bbox":
                        points, plabs = [center], [1]
                    elif detection_hint == "mask-area":
                        points, plabs = cls._gen_detection_hints_from_mask_area(
                            seg.crop_region[0],
                            seg.crop_region[1],
                            seg.cropped_mask,
                            mask_hint_threshold,
                            use_small_negative,
                        )

                    if mask_hint_use_negative == "Outter":
                        npoints, nplabs = cls._gen_negative_hints(
                            image_np.shape[0], image_np.shape[1], seg.crop_region[0], seg.crop_region[1], seg.crop_region[2], seg.crop_region[3]
                        )
                        points += npoints
                        plabs += nplabs

                    total_masks += sam_obj.predict(image_np, points, plabs, dilated_bbox, threshold)

            if len(total_masks) == 0:
                return torch.zeros((1, image_np.shape[0], image_np.shape[1]), dtype=torch.float32, device="cpu")

            combined = np.array(total_masks[0]).astype(np.uint8)
            for m in total_masks[1:]:
                m2 = np.array(m).astype(np.uint8)
                if combined.shape == m2.shape:
                    if cv2 is not None:
                        combined = cv2.bitwise_or(combined, m2)
                    else:
                        combined = np.bitwise_or(combined, m2)

            combined = combined.astype(np.float32)
            if int(dilation) != 0 and cv2 is not None:
                kernel = np.ones((abs(int(dilation)), abs(int(dilation))), np.uint8)
                combined = cv2.dilate(combined, kernel, 1) if int(dilation) > 0 else cv2.erode(combined, kernel, 1)

            return torch.from_numpy(combined).unsqueeze(0)
        finally:
            if callable(release):
                release()

    @classmethod
    def _do_detail(
        cls,
        image,
        segs,
        model,
        vae,
        guide_size,
        guide_size_for_bbox,
        max_size,
        seed,
        steps,
        cfg,
        sampler_name,
        scheduler,
        positive,
        negative,
        denoise,
        feather,
        noise_mask,
        force_inpaint,
        cycle,
        inpaint_model,
        noise_mask_feather,
        scheduler_func_opt,
        tiled_encode,
        tiled_decode,
    ):
        image = image.clone()
        enhanced_alpha_list = []
        enhanced_list = []
        cnet_images = []

        for i, seg in enumerate(segs[1]):
            cropped_image = cls.crop_ndarray4(image.cpu().numpy(), seg.crop_region)
            cropped_image = torch.from_numpy(cropped_image)

            mask = torch.from_numpy(seg.cropped_mask) if isinstance(seg.cropped_mask, np.ndarray) else seg.cropped_mask
            mask = cls.tensor_gaussian_blur_mask(mask, feather)
            if (seg.cropped_mask == 0).all().item():
                continue

            cropped_mask = seg.cropped_mask if noise_mask else None
            if not isinstance(positive, str):
                cropped_positive = [[cond, {k: cls.crop_condition_mask(v, image, seg.crop_region) if k == "mask" else v for k, v in details.items()}] for cond, details in positive]
            else:
                cropped_positive = positive

            if not isinstance(negative, str):
                cropped_negative = [[cond, {k: cls.crop_condition_mask(v, image, seg.crop_region) if k == "mask" else v for k, v in details.items()}] for cond, details in negative]
            else:
                cropped_negative = negative

            enhanced_image = cls.enhance_detail(
                cropped_image,
                model,
                vae,
                guide_size,
                guide_size_for_bbox,
                max_size,
                seg.bbox,
                seed + i,
                steps,
                cfg,
                sampler_name,
                scheduler,
                cropped_positive,
                cropped_negative,
                denoise,
                cropped_mask,
                force_inpaint,
                cycle,
                inpaint_model,
                noise_mask_feather,
                scheduler_func_opt,
                tiled_encode,
                tiled_decode,
            )
            if enhanced_image is None:
                continue

            image = image.cpu()
            enhanced_image = enhanced_image.cpu()
            cls.tensor_paste(image, enhanced_image, (seg.crop_region[0], seg.crop_region[1]), mask)
            enhanced_list.append(enhanced_image)

            enhanced_image_alpha = cls.tensor_convert_rgba(enhanced_image)
            resized_mask = cls.resize_mask(mask.squeeze(3), (enhanced_image.shape[1], enhanced_image.shape[2])).unsqueeze(3)
            cls.tensor_putalpha(enhanced_image_alpha, resized_mask)
            enhanced_alpha_list.append(enhanced_image_alpha)

        image_tensor = cls.tensor_convert_rgb(image)
        enhanced_list.sort(key=lambda x: x.shape, reverse=True)
        enhanced_alpha_list.sort(key=lambda x: x.shape, reverse=True)
        return image_tensor, enhanced_list, enhanced_alpha_list, cnet_images

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "vae": ("VAE",),
                "guide_size": ("FLOAT", {"default": 512, "min": 64, "max": MAX_RESOLUTION, "step": 8}),
                "guide_size_for": ("BOOLEAN", {"default": True, "label_on": "bbox", "label_off": "crop_region"}),
                "max_size": ("FLOAT", {"default": 1024, "min": 64, "max": MAX_RESOLUTION, "step": 8}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
                "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
                "cfg": ("FLOAT", {"default": 8.0, "min": 0.0, "max": 100.0, "step": 0.1, "round": 0.01}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS,),
                "scheduler": (cls._scheduler_options(),),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "denoise": ("FLOAT", {"default": 0.5, "min": 0.0001, "max": 1.0, "step": 0.01}),
                "feather": ("INT", {"default": 5, "min": 0, "max": 100, "step": 1}),
                "noise_mask": ("BOOLEAN", {"default": True}),
                "force_inpaint": ("BOOLEAN", {"default": True}),
                "bbox_threshold": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
                "bbox_dilation": ("INT", {"default": 10, "min": -512, "max": 512, "step": 1}),
                "bbox_crop_factor": ("FLOAT", {"default": 3.0, "min": 1.0, "max": 10.0, "step": 0.1}),
                "sam_detection_hint": (["center-1", "horizontal-2", "vertical-2", "rect-4", "diamond-4", "mask-area", "mask-points", "mask-point-bbox", "none"],),
                "sam_dilation": ("INT", {"default": 0, "min": -512, "max": 512, "step": 1}),
                "sam_threshold": ("FLOAT", {"default": 0.93, "min": 0.0, "max": 1.0, "step": 0.01}),
                "sam_bbox_expansion": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1}),
                "sam_mask_hint_threshold": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 1.0, "step": 0.01}),
                "sam_mask_hint_use_negative": (["False", "Small", "Outter"],),
                "drop_size": ("INT", {"default": 10, "min": 1, "max": MAX_RESOLUTION, "step": 1}),
                "bbox_detector": ("BBOX_DETECTOR",),
                "wildcard": ("STRING", {"multiline": True, "dynamicPrompts": False}),
                "cycle": ("INT", {"default": 1, "min": 1, "max": 10, "step": 1}),
            },
            "optional": {
                "sam_model_opt": ("SAM_MODEL",),
                "sam_model_name": ("STRING", {"default": ""}),
                "segm_detector_opt": ("SEGM_DETECTOR",),
                "detailer_hook": ("DETAILER_HOOK",),
                "inpaint_model": ("BOOLEAN", {"default": False}),
                "noise_mask_feather": ("INT", {"default": 20, "min": 0, "max": 100, "step": 1}),
                "scheduler_func_opt": ("SCHEDULER_FUNC",),
                "tiled_encode": ("BOOLEAN", {"default": False}),
                "tiled_decode": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "MASK", "DETAILER_PIPE", "IMAGE")
    RETURN_NAMES = ("image", "cropped_refined", "cropped_enhanced_alpha", "mask", "detailer_pipe", "cnet_images")
    OUTPUT_IS_LIST = (False, True, True, False, False, True)
    FUNCTION = "doit"
    CATEGORY = "Pixora"

    def doit(
        self,
        image,
        model,
        clip,
        vae,
        guide_size,
        guide_size_for,
        max_size,
        seed,
        steps,
        cfg,
        sampler_name,
        scheduler,
        positive,
        negative,
        denoise,
        feather,
        noise_mask,
        force_inpaint,
        bbox_threshold,
        bbox_dilation,
        bbox_crop_factor,
        sam_detection_hint,
        sam_dilation,
        sam_threshold,
        sam_bbox_expansion,
        sam_mask_hint_threshold,
        sam_mask_hint_use_negative,
        drop_size,
        bbox_detector,
        wildcard,
        cycle,
        sam_model_opt=None,
        sam_model_name="",
        segm_detector_opt=None,
        detailer_hook=None,
        inpaint_model=False,
        noise_mask_feather=20,
        scheduler_func_opt=None,
        tiled_encode=False,
        tiled_decode=False,
    ):
        if not hasattr(bbox_detector, "detect"):
            raise RuntimeError("Invalid bbox_detector passed to PixoraFaceDetailer. Expected BBOX_DETECTOR with detect().")

        result_img = None
        result_mask = None
        result_cropped_enhanced = []
        result_cropped_enhanced_alpha = []
        result_cnet_images = []

        for i, single_image in enumerate(image):
            single_batch = single_image.unsqueeze(0)
            bbox_detector.setAux("face")
            segs = bbox_detector.detect(single_batch, bbox_threshold, bbox_dilation, bbox_crop_factor, drop_size, detailer_hook=detailer_hook)
            bbox_detector.setAux(None)

            resolved_sam_model = sam_model_opt
            if resolved_sam_model is None and str(sam_model_name).strip() != "":
                resolved_sam_model = self._load_sam_model(sam_model_name)

            if resolved_sam_model is not None:
                sam_mask = self._make_sam_mask(
                    resolved_sam_model,
                    segs,
                    single_batch,
                    sam_detection_hint,
                    sam_dilation,
                    sam_threshold,
                    sam_bbox_expansion,
                    sam_mask_hint_threshold,
                    sam_mask_hint_use_negative,
                )
                segs = self.segs_bitwise_and_mask(segs, sam_mask)
            elif segm_detector_opt is not None:
                segm_segs = segm_detector_opt.detect(single_batch, bbox_threshold, bbox_dilation, bbox_crop_factor, drop_size)
                if getattr(segm_detector_opt, "override_bbox_by_segm", False):
                    segs = segm_segs
                else:
                    segm_mask = self.segs_to_combined_mask(segm_segs)
                    segs = self.segs_bitwise_and_mask(segs, segm_mask)

            if len(segs[1]) > 0:
                enhanced_img, cropped_enhanced, cropped_enhanced_alpha, cnet_images = self._do_detail(
                    single_batch,
                    segs,
                    model,
                    vae,
                    guide_size,
                    guide_size_for,
                    max_size,
                    seed + i,
                    steps,
                    cfg,
                    sampler_name,
                    scheduler,
                    positive,
                    negative,
                    denoise,
                    feather,
                    noise_mask,
                    force_inpaint,
                    cycle,
                    inpaint_model,
                    noise_mask_feather,
                    scheduler_func_opt,
                    tiled_encode,
                    tiled_decode,
                )
            else:
                enhanced_img = single_batch
                cropped_enhanced = []
                cropped_enhanced_alpha = []
                cnet_images = []

            mask = self.segs_to_combined_mask(segs)
            if len(cropped_enhanced) == 0:
                cropped_enhanced = [self.empty_pil_tensor()]
            if len(cropped_enhanced_alpha) == 0:
                cropped_enhanced_alpha = [self.empty_pil_tensor()]
            if len(cnet_images) == 0:
                cnet_images = [self.empty_pil_tensor()]

            result_img = torch.cat((result_img, enhanced_img), dim=0) if result_img is not None else enhanced_img
            result_mask = torch.cat((result_mask, mask), dim=0) if result_mask is not None else mask
            result_cropped_enhanced.extend(cropped_enhanced)
            result_cropped_enhanced_alpha.extend(cropped_enhanced_alpha)
            result_cnet_images.extend(cnet_images)

        detailer_pipe = (
            model,
            clip,
            vae,
            positive,
            negative,
            wildcard,
            bbox_detector,
            segm_detector_opt,
            sam_model_opt,
            detailer_hook,
            None,
            None,
            None,
            None,
        )
        return result_img, result_cropped_enhanced, result_cropped_enhanced_alpha, result_mask, detailer_pipe, result_cnet_images
