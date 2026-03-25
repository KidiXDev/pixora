import json
import os

import comfy.model_management as model_management
import comfy.sample
import comfy.samplers
import comfy.sd
import comfy.utils
import folder_paths
import latent_preview
import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence
from PIL.PngImagePlugin import PngInfo
from comfy.cli_args import args
from spandrel import ImageModelDescriptor, ModelLoader

from .detailer import PixoraFaceBBoxDetectorProvider, PixoraFaceDetailer
from .sam import PixoraLoadSAMModel


class PixoraSaveImage:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "The images to save."}),
                "sub_directory": (
                    "STRING",
                    {
                        "default": "txt2img",
                        "tooltip": "Specify sub-directory within Pixora output (e.g., txt2img, img2img, or any custom name).",
                    },
                ),
                "filename_prefix": ("STRING", {"default": "Pixora", "tooltip": "Prefix for the saved filename."}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "Pixora"

    def save_images(self, images, sub_directory, filename_prefix="Pixora", prompt=None, extra_pnginfo=None):
        sub_directory = sub_directory.strip().strip('"')

        if os.path.isabs(sub_directory):
            base_output_dir = sub_directory
            rel_prefix = filename_prefix
        else:
            base_output_dir = self.output_dir
            sub_dir = sub_directory if sub_directory else "txt2img"
            rel_prefix = os.path.join(sub_dir, filename_prefix)

        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            rel_prefix, base_output_dir, images[0].shape[1], images[0].shape[0]
        )

        results = []
        for batch_number, image in enumerate(images):
            i = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

            metadata = None
            if not args.disable_metadata:
                metadata = PngInfo()
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for x in extra_pnginfo:
                        metadata.add_text(x, json.dumps(extra_pnginfo[x]))

            filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch_num}_{counter:05}_.png"
            saved_path = os.path.join(full_output_folder, file)
            img.save(saved_path, pnginfo=metadata, compress_level=self.compress_level)

            results.append({"filename": file, "subfolder": subfolder, "type": "output", "path": saved_path})
            counter += 1

        return {"ui": {"images": results}}


class PixoraLoadCheckpoint:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ckpt_path": (
                    "STRING",
                    {"default": "", "tooltip": "The absolute path to the checkpoint file (e.g., F:\\Models\\model.safetensors)."},
                ),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    FUNCTION = "load_checkpoint"
    CATEGORY = "Pixora"

    def load_checkpoint(self, ckpt_path):
        ckpt_path = os.path.normpath(ckpt_path.strip().strip('"'))
        if not os.path.exists(ckpt_path):
            raise FileNotFoundError(f"Checkpoint file not found: {ckpt_path}")

        out = comfy.sd.load_checkpoint_guess_config(
            ckpt_path,
            output_vae=True,
            output_clip=True,
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
        )
        return out[:3]


class PixoraLoadImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_path": (
                    "STRING",
                    {"default": "", "tooltip": "The absolute path to the image file (e.g., C:\\Images\\photo.jpg)."},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    FUNCTION = "load_image"
    CATEGORY = "Pixora"

    def load_image(self, image_path):
        image_path = os.path.normpath(image_path.strip().strip('"'))
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image path does not exist: {image_path}")

        img = Image.open(image_path)
        output_images = []
        output_masks = []

        for i in ImageSequence.Iterator(img):
            i = ImageOps.exif_transpose(i)
            if i.mode == "I":
                i = i.point(lambda p: p * (1 / 256)).convert("L")

            image = i.convert("RGB")
            image = np.array(image).astype(np.float32) / 255.0
            image = torch.from_numpy(image)[None,]

            if "A" in i.getbands():
                mask = np.array(i.getchannel("A")).astype(np.float32) / 255.0
                mask = 1.0 - torch.from_numpy(mask)
            else:
                mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu")

            output_images.append(image)
            output_masks.append(mask.unsqueeze(0))

        if len(output_images) > 1:
            output_image = torch.cat(output_images, dim=0)
            output_mask = torch.cat(output_masks, dim=0)
        else:
            output_image = output_images[0]
            output_mask = output_masks[0]

        return (output_image, output_mask)

    @classmethod
    def IS_CHANGED(cls, image_path):
        image_path = os.path.normpath(image_path.strip().strip('"'))
        return os.path.getmtime(image_path) if os.path.exists(image_path) else ""


class PixoraImageUpscaler:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "upscale_model": (folder_paths.get_filename_list("upscale_models"),),
                "multiplier": ("FLOAT", {"default": 2.0, "min": 0.1, "max": 10.0, "step": 0.1}),
                "upscale_method": (["nearest-exact", "bilinear", "area", "bicubic", "bislerp", "lanczos"], {"default": "nearest-exact"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "upscale"
    CATEGORY = "Pixora"

    def upscale(self, image, upscale_model, multiplier, upscale_method):
        batch_size, height, width, _ = image.shape
        dest_w = max(8, int((width * multiplier) // 8 * 8))
        dest_h = max(8, int((height * multiplier) // 8 * 8))

        device = model_management.get_torch_device()
        model_path = folder_paths.get_full_path_or_raise("upscale_models", upscale_model)
        sd = comfy.utils.load_torch_file(model_path, safe_load=True)
        if "module.layers.0.residual_group.blocks.0.norm1.weight" in sd:
            sd = comfy.utils.state_dict_prefix_replace(sd, {"module.": ""})

        upscale_model_obj = ModelLoader().load_from_state_dict(sd).eval()
        if not isinstance(upscale_model_obj, ImageModelDescriptor):
            raise Exception("PixoraImageUpscaler: Upscale model must be a single-image upscaler.")

        in_img = image.movedim(-1, -3).to(device)
        memory_required = model_management.module_size(upscale_model_obj.model)
        memory_required += (512 * 512 * 3) * image.element_size() * max(upscale_model_obj.scale, 1.0) * 128.0
        model_management.free_memory(memory_required, device)
        upscale_model_obj.to(device)

        tile = 512
        overlap = 32
        oom = True
        try:
            while oom:
                try:
                    steps = in_img.shape[0] * comfy.utils.get_tiled_scale_steps(width, height, tile_x=tile, tile_y=tile, overlap=overlap)
                    pbar = comfy.utils.ProgressBar(steps)
                    s = comfy.utils.tiled_scale(
                        in_img,
                        lambda a: upscale_model_obj(a),
                        tile_x=tile,
                        tile_y=tile,
                        overlap=overlap,
                        upscale_amount=upscale_model_obj.scale,
                        pbar=pbar,
                    )
                    oom = False
                except Exception as e:
                    model_management.raise_non_oom(e)
                    tile //= 2
                    if tile < 128:
                        raise e
        finally:
            upscale_model_obj.to("cpu")

        s = s.movedim(-3, -1).cpu()
        if s.shape[1] != dest_h or s.shape[2] != dest_w:
            s = s.movedim(-1, -3)
            s = comfy.utils.common_upscale(s, dest_w, dest_h, upscale_method, "disabled")
            s = s.movedim(-3, -1)

        return (torch.clamp(s, 0.0, 1.0),)


class PixoraKSamplerWithVariation:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFFFFFFFFFF, "tooltip": "Base seed."}),
                "variation_seed": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFFFFFFFFFF, "tooltip": "Variation (sub-seed)."}),
                "variation_strength": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "Interpolation strength between base noise and variation noise."}),
                "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
                "cfg": ("FLOAT", {"default": 8.0, "min": 0.0, "max": 100.0, "step": 0.1, "round": 0.01}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS,),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS,),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "latent_image": ("LATENT",),
                "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "sample"
    CATEGORY = "Pixora"

    @staticmethod
    def _slerp_noise(noise_a, noise_b, strength):
        t = float(min(max(strength, 0.0), 1.0))
        if t <= 0.0:
            return noise_a
        if t >= 1.0:
            return noise_b

        a = noise_a.reshape(noise_a.shape[0], -1)
        b = noise_b.reshape(noise_b.shape[0], -1)
        a_norm = torch.nn.functional.normalize(a, dim=1)
        b_norm = torch.nn.functional.normalize(b, dim=1)
        dot = torch.sum(a_norm * b_norm, dim=1, keepdim=True).clamp(-0.9995, 0.9995)
        omega = torch.acos(dot)
        sin_omega = torch.sin(omega)
        near_linear = torch.abs(sin_omega) < 1e-6
        interp = (torch.sin((1.0 - t) * omega) / sin_omega) * a + (torch.sin(t * omega) / sin_omega) * b
        lerp = (1.0 - t) * a + t * b
        out = torch.where(near_linear, lerp, interp)
        return out.reshape_as(noise_a)

    def sample(self, model, seed, variation_seed, variation_strength, steps, cfg, sampler_name, scheduler, positive, negative, latent_image, denoise=1.0):
        latent_samples = comfy.sample.fix_empty_latent_channels(model, latent_image["samples"])
        batch_inds = latent_image["batch_index"] if "batch_index" in latent_image else None
        base_noise = comfy.sample.prepare_noise(latent_samples, seed, batch_inds)
        strength = float(min(max(variation_strength, 0.0), 1.0))
        noise = self._slerp_noise(base_noise, comfy.sample.prepare_noise(latent_samples, variation_seed, batch_inds), strength) if strength > 0.0 else base_noise
        noise_mask = latent_image["noise_mask"] if "noise_mask" in latent_image else None
        callback = latent_preview.prepare_callback(model, steps)
        disable_pbar = not comfy.utils.PROGRESS_BAR_ENABLED

        samples = comfy.sample.sample(
            model,
            noise,
            steps,
            cfg,
            sampler_name,
            scheduler,
            positive,
            negative,
            latent_samples,
            denoise=denoise,
            disable_noise=False,
            start_step=None,
            last_step=None,
            force_full_denoise=False,
            noise_mask=noise_mask,
            callback=callback,
            disable_pbar=disable_pbar,
            seed=seed,
        )

        out = latent_image.copy()
        out["samples"] = samples
        return (out,)


NODE_CLASS_MAPPINGS = {
    "PixoraSaveImage": PixoraSaveImage,
    "PixoraLoadCheckpoint": PixoraLoadCheckpoint,
    "PixoraLoadImage": PixoraLoadImage,
    "PixoraImageUpscaler": PixoraImageUpscaler,
    "PixoraKSamplerWithVariation": PixoraKSamplerWithVariation,
    "PixoraFaceBBoxDetectorProvider": PixoraFaceBBoxDetectorProvider,
    "PixoraLoadSAMModel": PixoraLoadSAMModel,
    "PixoraFaceDetailer": PixoraFaceDetailer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixoraSaveImage": "Pixora Save Image",
    "PixoraLoadCheckpoint": "Pixora Load Checkpoint",
    "PixoraLoadImage": "Pixora Load Image",
    "PixoraImageUpscaler": "Pixora Image Upscaler",
    "PixoraKSamplerWithVariation": "Pixora KSampler With Variation",
    "PixoraFaceBBoxDetectorProvider": "Pixora Face BBox Detector Provider",
    "PixoraLoadSAMModel": "Pixora Load SAM Model",
    "PixoraFaceDetailer": "Pixora Face Detailer",
}
