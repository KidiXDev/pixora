import math

import comfy.sample
import comfy.samplers
import comfy.utils
import latent_preview
import numpy as np
import nodes
import torch

try:
    import torchvision
except Exception:
    torchvision = None

try:
    from comfy_extras import nodes_differential_diffusion
except Exception:
    nodes_differential_diffusion = None


class PixoraCore:
    @staticmethod
    def make_2d_mask(mask):
        if mask is None:
            return None
        if isinstance(mask, np.ndarray):
            mask = torch.from_numpy(mask)
        if len(mask.shape) == 4:
            return mask.squeeze(0).squeeze(0)
        if len(mask.shape) == 3:
            return mask.squeeze(0)
        return mask

    @staticmethod
    def make_4d_mask(mask):
        if mask is None:
            return None
        if isinstance(mask, np.ndarray):
            mask = torch.from_numpy(mask)
        if len(mask.shape) == 3:
            return mask.unsqueeze(0)
        if len(mask.shape) == 2:
            return mask.unsqueeze(0).unsqueeze(0)
        return mask

    @staticmethod
    def tensor_resize(image, w, h):
        image = image.permute(0, 3, 1, 2)
        image = torch.nn.functional.interpolate(image, size=(h, w), mode="bilinear", align_corners=False)
        image = image.permute(0, 2, 3, 1)
        return image

    @classmethod
    def resize_mask(cls, mask, size_hw):
        mask = cls.make_4d_mask(mask)
        resized = torch.nn.functional.interpolate(mask, size=size_hw, mode="bilinear", align_corners=False)
        return resized.squeeze(0)

    @classmethod
    def tensor_gaussian_blur_mask(cls, mask, kernel_size, sigma=10.0):
        if mask is None:
            return None
        if isinstance(mask, np.ndarray):
            mask = torch.from_numpy(mask)
        if mask.ndim == 2:
            mask = mask[None, ..., None]
        elif mask.ndim == 3:
            mask = mask[..., None]
        if kernel_size <= 0:
            return mask
        kernel_size = kernel_size * 2 + 1
        shortest = min(mask.shape[1], mask.shape[2])
        if shortest <= kernel_size:
            kernel_size = int(shortest / 2)
            if kernel_size % 2 == 0:
                kernel_size += 1
        if kernel_size < 3 or torchvision is None:
            return mask
        blur = torchvision.transforms.GaussianBlur(kernel_size=kernel_size, sigma=sigma)
        tensor = mask[:, None, ..., 0]
        tensor = blur(tensor)
        return tensor[:, 0, ..., None]

    @staticmethod
    def tensor_convert_rgb(image):
        if image.shape[-1] == 3:
            return image
        if image.shape[-1] == 4:
            return image[..., :3].clone()
        if image.shape[-1] == 1:
            return image.expand(-1, -1, -1, 3).clone()
        raise ValueError("Unsupported channel count")

    @staticmethod
    def tensor_convert_rgba(image):
        if image.shape[-1] == 4:
            return image
        if image.shape[-1] == 3:
            alpha = torch.ones((*image.shape[:-1], 1), dtype=image.dtype, device=image.device)
            return torch.cat((image, alpha), dim=-1)
        if image.shape[-1] == 1:
            rgb = image.expand(-1, -1, -1, 3)
            alpha = torch.ones((*image.shape[:-1], 1), dtype=image.dtype, device=image.device)
            return torch.cat((rgb, alpha), dim=-1)
        raise ValueError("Unsupported channel count")

    @staticmethod
    def tensor_putalpha(image, mask):
        image[..., -1] = mask[..., 0]

    @classmethod
    def tensor_paste(cls, image1, image2, left_top, mask):
        if image2.shape[1:3] != mask.shape[1:3]:
            resized = cls.resize_mask(mask.squeeze(dim=3), (image2.shape[1], image2.shape[2]))
            mask = resized.unsqueeze(dim=3)

        x, y = left_top
        _, h1, w1, c1 = image1.shape
        _, h2, w2, c2 = image2.shape
        w = min(w1, x + w2) - x
        h = min(h1, y + h2) - y
        if w <= 0 or h <= 0:
            return

        mask = mask[:, :h, :w, :]
        region1 = image1[:, y : y + h, x : x + w, :]
        region2 = image2[:, :h, :w, :]

        if c1 == 3 and c2 == 3:
            image1[:, y : y + h, x : x + w, :] = (1 - mask) * region1 + mask * region2
        elif c1 == 4 and c2 == 4:
            image1[:, y : y + h, x : x + w, :3] = (1 - mask) * region1[:, :, :, :3] + mask * region2[:, :, :, :3]
            a1 = region1[:, :, :, 3:4]
            a2 = region2[:, :, :, 3:4] * mask
            image1[:, y : y + h, x : x + w, 3:4] = a1 + a2 * (1 - a1)
        elif c1 == 4 and c2 == 3:
            image1[:, y : y + h, x : x + w, :3] = (1 - mask) * region1[:, :, :, :3] + mask * region2
            image1[:, y : y + h, x : x + w, 3:4] = region1[:, :, :, 3:4] * (1 - mask) + mask
        elif c1 == 3 and c2 == 4:
            effective_mask = mask * region2[:, :, :, 3:4]
            image1[:, y : y + h, x : x + w, :] = (1 - effective_mask) * region1 + effective_mask * region2[:, :, :, :3]

    @staticmethod
    def crop_ndarray4(npimg, crop_region):
        x1, y1, x2, y2 = crop_region
        return npimg[:, y1:y2, x1:x2, :]

    @staticmethod
    def to_latent_image(pixels, vae, vae_tiled_encode=False):
        x = pixels.shape[1]
        y = pixels.shape[2]
        if pixels.shape[1] != x or pixels.shape[2] != y:
            pixels = pixels[:, :x, :y, :]
        if vae_tiled_encode:
            return nodes.VAEEncodeTiled().encode(vae, pixels, 512, overlap=64)[0]
        return nodes.VAEEncode().encode(vae, pixels)[0]

    @staticmethod
    def crop_condition_mask(mask_value, image, crop_region):
        if not isinstance(mask_value, torch.Tensor):
            return mask_value
        mask = mask_value
        if mask.ndim == 2:
            mask = mask.unsqueeze(0)
        if mask.ndim == 4:
            mask = mask.squeeze(1)
        if mask.ndim != 3:
            return mask_value
        if mask.shape[0] != image.shape[0]:
            mask = mask[:1].expand(image.shape[0], -1, -1)
        x1, y1, x2, y2 = crop_region
        return mask[:, y1:y2, x1:x2]

    @classmethod
    def run_ksampler(
        cls,
        model,
        latent_image,
        seed,
        steps,
        cfg,
        sampler_name,
        scheduler,
        positive,
        negative,
        denoise,
        scheduler_func=None,
    ):
        latent_samples = comfy.sample.fix_empty_latent_channels(model, latent_image["samples"])
        batch_inds = latent_image["batch_index"] if "batch_index" in latent_image else None
        noise = comfy.sample.prepare_noise(latent_samples, seed, batch_inds)
        noise_mask = latent_image["noise_mask"] if "noise_mask" in latent_image else None
        callback = latent_preview.prepare_callback(model, steps)
        disable_pbar = not comfy.utils.PROGRESS_BAR_ENABLED

        if scheduler_func is not None and callable(scheduler_func):
            try:
                advanced_steps = max(steps, math.floor(steps / max(denoise, 1e-6)))
                sigmas = scheduler_func(model, sampler_name, advanced_steps)
                start_at_step = max(0, advanced_steps - steps)
                end_at_step = min(len(sigmas) - 1, start_at_step + steps)
                sigmas = sigmas[start_at_step : end_at_step + 1]
                if len(sigmas) > 0:
                    sigmas = sigmas.clone()
                    sigmas[-1] = 0

                sampler_obj = comfy.samplers.sampler_object(sampler_name)
                return comfy.sample.sample_custom(
                    model,
                    noise,
                    cfg,
                    sampler_obj,
                    sigmas,
                    positive,
                    negative,
                    latent_samples,
                    noise_mask=noise_mask,
                    callback=callback,
                    disable_pbar=disable_pbar,
                    seed=seed,
                )
            except Exception:
                pass

        return comfy.sample.sample(
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

    @classmethod
    def enhance_detail(
        cls,
        image,
        model,
        vae,
        guide_size,
        guide_size_for_bbox,
        max_size,
        bbox,
        seed,
        steps,
        cfg,
        sampler_name,
        scheduler,
        positive,
        negative,
        denoise,
        noise_mask,
        force_inpaint,
        cycle,
        inpaint_model,
        noise_mask_feather,
        scheduler_func,
        tiled_encode,
        tiled_decode,
    ):
        if noise_mask is not None:
            noise_mask = cls.tensor_gaussian_blur_mask(noise_mask, noise_mask_feather).squeeze(3)
            if (
                noise_mask_feather > 0
                and nodes_differential_diffusion is not None
                and hasattr(model, "model_options")
                and "denoise_mask_function" not in model.model_options
            ):
                model = nodes_differential_diffusion.DifferentialDiffusion().execute(model)[0]

        h = image.shape[1]
        w = image.shape[2]
        bbox_h = bbox[3] - bbox[1]
        bbox_w = bbox[2] - bbox[0]
        if not force_inpaint and bbox_h >= guide_size and bbox_w >= guide_size:
            return None

        upscale = guide_size / max(1, min(bbox_w, bbox_h) if guide_size_for_bbox else min(w, h))
        new_w = int(w * upscale)
        new_h = int(h * upscale)
        if new_w > max_size or new_h > max_size:
            upscale *= max_size / max(new_w, new_h)
            new_w = int(w * upscale)
            new_h = int(h * upscale)

        if upscale <= 1.0 or new_w == 0 or new_h == 0:
            if not force_inpaint:
                return None
            upscale = 1.0
            new_w = w
            new_h = h

        upscaled_image = cls.tensor_resize(image, new_w, new_h)
        if noise_mask is not None and inpaint_model:
            encoder = nodes.InpaintModelConditioning().encode
            if "noise_mask" in encoder.__code__.co_varnames:
                positive2, negative2, latent_image = encoder(positive, negative, upscaled_image, vae, mask=noise_mask, noise_mask=True)
            else:
                positive2, negative2, latent_image = encoder(positive, negative, upscaled_image, vae, noise_mask)
        else:
            positive2, negative2 = positive, negative
            latent_image = cls.to_latent_image(upscaled_image, vae, vae_tiled_encode=tiled_encode)
            if noise_mask is not None:
                latent_image["noise_mask"] = noise_mask

        refined_latent = latent_image
        for i in range(cycle):
            sampled = cls.run_ksampler(
                model,
                refined_latent,
                seed + i,
                steps,
                cfg,
                sampler_name,
                scheduler,
                positive2,
                negative2,
                denoise,
                scheduler_func=scheduler_func,
            )
            refined_latent = refined_latent.copy()
            refined_latent["samples"] = sampled

        if tiled_decode:
            refined_image = nodes.VAEDecodeTiled().decode(vae, refined_latent, 512)[0]
        else:
            try:
                refined_image = vae.decode(refined_latent["samples"])
            except Exception:
                refined_image = vae.decode_tiled(refined_latent["samples"], tile_x=64, tile_y=64)

        if len(refined_image.shape) == 5:
            refined_image = refined_image.squeeze(0)
        refined_image = cls.tensor_resize(refined_image, w, h)
        return refined_image.cpu()

    @staticmethod
    def empty_pil_tensor(w=64, h=64):
        return torch.zeros((1, h, w, 3), dtype=torch.float32)
