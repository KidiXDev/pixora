import os
import json
import torch
import numpy as np
from PIL import Image, ImageOps, ImageSequence
from PIL.PngImagePlugin import PngInfo

import folder_paths
import comfy.utils
import comfy.sd
import comfy.model_management as model_management
import comfy.samplers
from comfy.cli_args import args
from spandrel import ModelLoader, ImageModelDescriptor


class PixoraSaveImage:
    """
    Saves images to Pixora's output directory.
    Target: <pixora_data_dir>/output/txt2img or <pixora_data_dir>/output/img2img
    """

    def __init__(self):
        # Use ComfyUI's standard output directory instead of a hardcoded path
        self.output_dir = folder_paths.get_output_directory()
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(s):
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
            # If an absolute path is provided, use it as the base directory
            base_output_dir = sub_directory
            rel_prefix = filename_prefix
        else:
            # Otherwise, save relative to ComfyUI's output directory
            base_output_dir = self.output_dir
            sub_dir = sub_directory if sub_directory else "txt2img"
            rel_prefix = os.path.join(sub_dir, filename_prefix)

        # We pass the calculated base_output_dir so get_save_image_path allows saving to that location
        full_output_folder, filename, counter, subfolder, filename_prefix_final = folder_paths.get_save_image_path(
            rel_prefix, base_output_dir, images[0].shape[1], images[0].shape[0]
        )

        results = list()
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

            results.append(
                {
                    "filename": file,
                    "subfolder": subfolder,
                    "type": "output",
                    "path": saved_path,
                }
            )
            counter += 1

        return {"ui": {"images": results}}


class PixoraLoadCheckpoint:
    """
    Loads a checkpoint from an absolute file path.
    """

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
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

        import comfy.sd

        # Load the checkpoint using ComfyUI's guess_config loader
        out = comfy.sd.load_checkpoint_guess_config(
            ckpt_path,
            output_vae=True,
            output_clip=True,
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
        )
        return out[:3]


class PixoraLoadImage:
    """
    Loads an image from an absolute file path.
    """

    @classmethod
    def INPUT_TYPES(s):
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
                i = i.point(lambda i: i * (1 / 256)).convert("L")

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
    def IS_CHANGED(s, image_path):
        image_path = os.path.normpath(image_path.strip().strip('"'))
        if os.path.exists(image_path):
            return os.path.getmtime(image_path)
        return ""


class PixoraImageUpscaler:
    """
    Upscales an image using an upscale model and a multiplier.
    """

    @classmethod
    def INPUT_TYPES(s):
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
        # Calculate target dimensions (aligning to 8 like A1111)
        batch_size, height, width, _ = image.shape
        dest_w = int((width * multiplier) // 8 * 8)
        dest_h = int((height * multiplier) // 8 * 8)

        # Ensure we have at least 8 pixels
        dest_w = max(8, dest_w)
        dest_h = max(8, dest_h)

        print(f"PixoraImageUpscaler: Input {width}x{height} -> Target {dest_w}x{dest_h} (Multiplier {multiplier})")

        device = model_management.get_torch_device()

        # Load AI Upscale Model
        model_path = folder_paths.get_full_path_or_raise("upscale_models", upscale_model)
        sd = comfy.utils.load_torch_file(model_path, safe_load=True)
        if "module.layers.0.residual_group.blocks.0.norm1.weight" in sd:
            sd = comfy.utils.state_dict_prefix_replace(sd, {"module.": ""})

        upscale_model_obj = ModelLoader().load_from_state_dict(sd).eval()

        if not isinstance(upscale_model_obj, ImageModelDescriptor):
            raise Exception("PixoraImageUpscaler: Upscale model must be a single-image upscaler.")

        # Prepare image for model inference [B, C, H, W]
        in_img = image.movedim(-1, -3).to(device)

        # Move model to device
        memory_required = model_management.module_size(upscale_model_obj.model)
        # Conservative memory overhead for inference
        memory_required += (512 * 512 * 3) * image.element_size() * max(upscale_model_obj.scale, 1.0) * 128.0
        model_management.free_memory(memory_required, device)
        upscale_model_obj.to(device)

        tile = 512
        overlap = 32

        # Step 1: Neural Upscale (e.g. 512 -> 2048 if model is 4x)
        oom = True
        try:
            print(f"PixoraImageUpscaler: Model inference starting (scaling by {upscale_model_obj.scale}x)...")
            while oom:
                try:
                    steps = in_img.shape[0] * comfy.utils.get_tiled_scale_steps(width, height, tile_x=tile, tile_y=tile, overlap=overlap)
                    pbar = comfy.utils.ProgressBar(steps)
                    # This performs the AI upscale
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
                    print(f"PixoraImageUpscaler: OOM encounter, reducing tile size to {tile}")
                    if tile < 128:
                        raise e
        finally:
            upscale_model_obj.to("cpu")

        # Move back to [B, H, W, C] and CPU
        s = s.movedim(-3, -1).cpu()
        print(f"PixoraImageUpscaler: Model output shape: {s.shape[2]}x{s.shape[1]}")

        # Step 2: Resize to User-Requested Multiplier (if model output doesn't match target)
        if s.shape[1] != dest_h or s.shape[2] != dest_w:
            print(f"PixoraImageUpscaler: Adjusting result from {s.shape[2]}x{s.shape[1]} to {dest_w}x{dest_h} using {upscale_method}")
            # [B, H, W, C] -> [B, C, H, W] for common_upscale
            s = s.movedim(-1, -3)
            s = comfy.utils.common_upscale(s, dest_w, dest_h, upscale_method, "disabled")
            # [B, C, H, W] -> [B, H, W, C]
            s = s.movedim(-3, -1)

        print(f"PixoraImageUpscaler: Upscale complete. Final result: {s.shape[2]}x{s.shape[1]}")
        return (torch.clamp(s, 0.0, 1.0),)


# Export mappings
NODE_CLASS_MAPPINGS = {
    "PixoraSaveImage": PixoraSaveImage,
    "PixoraLoadCheckpoint": PixoraLoadCheckpoint,
    "PixoraLoadImage": PixoraLoadImage,
    "PixoraImageUpscaler": PixoraImageUpscaler,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixoraSaveImage": "Pixora Save Image",
    "PixoraLoadCheckpoint": "Pixora Load Checkpoint",
    "PixoraLoadImage": "Pixora Load Image",
    "PixoraImageUpscaler": "Pixora Image Upscaler",
}
