package services

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"pixora/internal/config"
	"strconv"
	"strings"
	"time"
)

func (s *GenerationService) PreviewText2ImageWorkflow(req GenerationRequest) (string, error) {
	preview, err := s.buildText2ImageWorkflowPreview(req)
	if err != nil {
		return "", err
	}

	payload, err := json.MarshalIndent(preview, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal workflow preview: %w", err)
	}

	return string(payload), nil
}

func (s *GenerationService) PrepareEmbeddedText2ImageWorkflow(req GenerationRequest) (string, error) {
	preview, runtimeRoot, err := s.buildText2ImageWorkflowPreviewWithRuntimeRoot(req)
	if err != nil {
		return "", err
	}

	relativePath := fmt.Sprintf("pixora-txt2img-%d-api.json", time.Now().UnixNano())
	absolutePath := filepath.Join(
		runtimeRoot,
		"backend",
		"comfy",
		"ComfyUI",
		"user",
		"default",
		relativePath,
	)

	if err := os.MkdirAll(filepath.Dir(absolutePath), 0755); err != nil {
		return "", fmt.Errorf("create embedded workflow directory: %w", err)
	}

	payload, err := json.MarshalIndent(preview.Prompt, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal embedded workflow: %w", err)
	}

	if err := os.WriteFile(absolutePath, payload, 0644); err != nil {
		return "", fmt.Errorf("write embedded workflow: %w", err)
	}

	return relativePath, nil
}

func (s *GenerationService) buildText2ImageWorkflowPreview(req GenerationRequest) (*WorkflowPreview, error) {
	preview, _, err := s.buildText2ImageWorkflowPreviewWithRuntimeRoot(req)
	return preview, err
}

func (s *GenerationService) buildText2ImageWorkflowPreviewWithRuntimeRoot(req GenerationRequest) (*WorkflowPreview, string, error) {
	if s.config == nil {
		return nil, "", fmt.Errorf("missing config manager")
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "txt2img"
	}
	if mode != "txt2img" {
		return nil, "", fmt.Errorf("only txt2img workflow preview is supported for now")
	}
	req = normalizeGenerationRequest(req)

	cfg := s.config.GetComfyUIConfig()
	runtimeRoot, err := resolveRuntimeRoot(cfg.RootDir)
	if err != nil {
		return nil, "", fmt.Errorf("resolve runtime root: %w", err)
	}

	workflowPath := filepath.Join(runtimeRoot, "backend", "workflow", "PixoraTxt2Img.json")
	workflow, err := loadWorkflowTemplate(workflowPath)
	if err != nil {
		return nil, "", err
	}

	outputDir, err := resolveGenerationOutputDirPath(cfg, mode)
	if err != nil {
		return nil, "", err
	}

	modelsRoot, modelsErr := resolveGenerationModelsRoot(cfg)

	resolvedSeeds := resolveGenerationSeeds(req.Seed, req.VariationSeed, req.VariationSeedStrength)
	if err := injectTxt2ImgWorkflow(workflow, req, resolvedSeeds, outputDir, modelsRoot, modelsErr); err != nil {
		return nil, "", err
	}

	return &WorkflowPreview{
		Mode:         mode,
		Prompt:       workflow,
		OutputDir:    outputDir,
		ResolvedSeed: strconv.FormatInt(resolvedSeeds.BaseSeed, 10),
	}, runtimeRoot, nil
}

func normalizeGenerationRequest(req GenerationRequest) GenerationRequest {
	if req.Steps <= 0 {
		req.Steps = defaultGenerationSteps
	}
	if req.CFGScale <= 0 {
		req.CFGScale = defaultGenerationCFGScale
	}
	if req.Width <= 0 {
		req.Width = defaultGenerationWidth
	}
	if req.Height <= 0 {
		req.Height = defaultGenerationHeight
	}

	sampler := strings.TrimSpace(req.Sampler)
	if sampler == "" {
		req.Sampler = defaultGenerationSampler
	} else {
		normalizedSampler := strings.ToLower(sampler)
		switch normalizedSampler {
		case "euler a", "euler_a":
			req.Sampler = "euler_ancestral"
		default:
			req.Sampler = sampler
		}
	}

	scheduler := strings.TrimSpace(req.Scheduler)
	if scheduler == "" {
		req.Scheduler = defaultGenerationScheduler
	} else {
		req.Scheduler = scheduler
	}

	req.Refine.UpscaleMode = normalizeRefineUpscaleMode(req.Refine.UpscaleMode)
	req.Refine.UpscaleMethod = normalizeRefineUpscaleMethod(req.Refine.UpscaleMethod)
	if req.BatchSize <= 0 {
		req.BatchSize = 1
	}
	req.BatchSize = clampInt(req.BatchSize, 1, 100)
	if req.ClipSkip.StopAtLayer > -1 || req.ClipSkip.StopAtLayer < -24 {
		req.ClipSkip.StopAtLayer = -1
	}
	if req.Refine.ScaleBy <= 0 {
		req.Refine.ScaleBy = 1.5
	}
	req.Refine.ScaleBy = clampFloat(req.Refine.ScaleBy, 1.05, 4)
	if req.Refine.Steps <= 0 {
		req.Refine.Steps = 14
	}
	req.Refine.Steps = clampInt(req.Refine.Steps, 1, 80)
	if req.Refine.DenoiseStrength <= 0 {
		req.Refine.DenoiseStrength = 0.35
	}
	req.Refine.DenoiseStrength = clampFloat(req.Refine.DenoiseStrength, 0.05, 1)
	req.VariationSeedStrength = clampFloat(req.VariationSeedStrength, 0, 1)

	if req.FaceDetailer.GuideSize <= 0 {
		req.FaceDetailer.GuideSize = 512
	}
	req.FaceDetailer.GuideSize = clampInt(req.FaceDetailer.GuideSize, 64, 4096)
	if !req.FaceDetailer.GuideSizeFor {
		req.FaceDetailer.GuideSizeFor = true
	}

	if req.FaceDetailer.MaxSize <= 0 {
		req.FaceDetailer.MaxSize = 1024
	}
	req.FaceDetailer.MaxSize = clampInt(req.FaceDetailer.MaxSize, 64, 4096)

	if req.FaceDetailer.Denoise <= 0 {
		req.FaceDetailer.Denoise = 0.5
	}
	req.FaceDetailer.Denoise = clampFloat(req.FaceDetailer.Denoise, 0.0001, 1)
	req.FaceDetailer.Feather = clampInt(req.FaceDetailer.Feather, 0, 100)
	req.FaceDetailer.NoiseMaskFeather = clampInt(req.FaceDetailer.NoiseMaskFeather, 0, 100)

	if req.FaceDetailer.BboxThreshold <= 0 {
		req.FaceDetailer.BboxThreshold = 0.5
	}
	req.FaceDetailer.BboxThreshold = clampFloat(req.FaceDetailer.BboxThreshold, 0, 1)
	req.FaceDetailer.BboxDilation = clampInt(req.FaceDetailer.BboxDilation, -512, 512)

	if req.FaceDetailer.BboxCropFactor <= 0 {
		req.FaceDetailer.BboxCropFactor = 3
	}
	req.FaceDetailer.BboxCropFactor = clampFloat(req.FaceDetailer.BboxCropFactor, 1, 10)
	if strings.TrimSpace(req.FaceDetailer.BboxModel) == "" {
		req.FaceDetailer.BboxModel = "bbox/face_yolov8m.pt"
	}
	req.FaceDetailer.SAMDetectionHint = config.NormalizeSAMDetectionHint(req.FaceDetailer.SAMDetectionHint)
	req.FaceDetailer.SAMDilation = clampInt(req.FaceDetailer.SAMDilation, -512, 512)
	if req.FaceDetailer.SAMThreshold <= 0 {
		req.FaceDetailer.SAMThreshold = 0.93
	}
	req.FaceDetailer.SAMThreshold = clampFloat(req.FaceDetailer.SAMThreshold, 0, 1)
	req.FaceDetailer.SAMBboxExpansion = clampInt(req.FaceDetailer.SAMBboxExpansion, 0, 1000)
	if req.FaceDetailer.SAMMaskHintThreshold <= 0 {
		req.FaceDetailer.SAMMaskHintThreshold = 0.7
	}
	req.FaceDetailer.SAMMaskHintThreshold = clampFloat(req.FaceDetailer.SAMMaskHintThreshold, 0, 1)
	req.FaceDetailer.SAMMaskHintUseNegative = config.NormalizeSAMMaskHintUseNegative(req.FaceDetailer.SAMMaskHintUseNegative)

	if req.FaceDetailer.DropSize <= 0 {
		req.FaceDetailer.DropSize = 10
	}
	req.FaceDetailer.DropSize = clampInt(req.FaceDetailer.DropSize, 1, 4096)

	if req.FaceDetailer.Cycle <= 0 {
		req.FaceDetailer.Cycle = 1
	}
	req.FaceDetailer.Cycle = clampInt(req.FaceDetailer.Cycle, 1, 10)

	return req
}

func loadWorkflowTemplate(path string) (map[string]comfyWorkflowNode, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read workflow template %s: %w", path, err)
	}

	var graph map[string]comfyWorkflowNode
	if err := json.Unmarshal(data, &graph); err != nil {
		return nil, fmt.Errorf("parse workflow template %s: %w", path, err)
	}

	if len(graph) == 0 {
		return nil, fmt.Errorf("workflow template is empty")
	}

	return graph, nil
}

func injectTxt2ImgWorkflow(
	graph map[string]comfyWorkflowNode,
	req GenerationRequest,
	seeds generationSeedConfig,
	outputDir string,
	modelsRoot string,
	modelsErr error,
) error {
	positiveNodeID, err := findNodeByTitle(graph, "Positive", "CLIPTextEncode")
	if err != nil {
		return err
	}
	positiveNode := graph[positiveNodeID]
	positiveNode.Inputs["text"] = strings.TrimSpace(req.Prompt)
	graph[positiveNodeID] = positiveNode

	negativeNodeID, err := findNodeByTitle(graph, "Negative", "CLIPTextEncode")
	if err != nil {
		return err
	}
	negativeNode := graph[negativeNodeID]
	negativeNode.Inputs["text"] = strings.TrimSpace(req.NegativePrompt)
	graph[negativeNodeID] = negativeNode

	ksamplerNodeID, err := findNodeByTitle(graph, "KSampler", "KSampler")
	if err != nil {
		return err
	}
	ksamplerNode := graph[ksamplerNodeID]
	seedValue := seeds.BaseSeed
	ksamplerNode.Inputs["seed"] = seedValue
	ksamplerNode.Inputs["steps"] = clampInt(req.Steps, 1, 200)
	ksamplerNode.Inputs["cfg"] = clampFloat(req.CFGScale, 1, 30)
	ksamplerNode.Inputs["denoise"] = 1
	if seeds.UseVariation {
		ksamplerNode.ClassType = "PixoraKSamplerWithVariation"
		ksamplerNode.Inputs["variation_seed"] = seeds.VariationSeed
		ksamplerNode.Inputs["variation_strength"] = seeds.VariationStrength
	} else {
		ksamplerNode.ClassType = "KSampler"
		delete(ksamplerNode.Inputs, "variation_seed")
		delete(ksamplerNode.Inputs, "variation_strength")
	}
	if strings.TrimSpace(req.Sampler) != "" {
		ksamplerNode.Inputs["sampler_name"] = strings.TrimSpace(req.Sampler)
	}
	if strings.TrimSpace(req.Scheduler) != "" {
		ksamplerNode.Inputs["scheduler"] = strings.TrimSpace(req.Scheduler)
	}
	graph[ksamplerNodeID] = ksamplerNode

	emptyLatentNodeID, err := findNodeByTitle(graph, "Empty Latent Image", "EmptyLatentImage")
	if err != nil {
		return err
	}
	emptyLatentNode := graph[emptyLatentNodeID]
	emptyLatentNode.Inputs["width"] = clampInt(req.Width, 64, 4096)
	emptyLatentNode.Inputs["height"] = clampInt(req.Height, 64, 4096)
	emptyLatentNode.Inputs["batch_size"] = clampInt(req.BatchSize, 1, 100)
	graph[emptyLatentNodeID] = emptyLatentNode

	checkpointNodeID, err := findNodeByTitle(graph, "Load Checkpoint", "CheckpointLoaderSimple")
	if err != nil {
		return err
	}
	checkpointNode := graph[checkpointNodeID]
	if strings.TrimSpace(req.Model) != "" {
		checkpointNode.Inputs["ckpt_name"] = strings.TrimSpace(req.Model)
	}
	graph[checkpointNodeID] = checkpointNode

	clipInputLink := buildWorkflowLink(checkpointNodeID, 1)
	if req.ClipSkip.Enabled {
		clipSkipNodeID := nextWorkflowNodeID(graph)
		graph[clipSkipNodeID] = comfyWorkflowNode{
			ClassType: "CLIPSetLastLayer",
			Inputs: map[string]any{
				"stop_at_clip_layer": clampInt(req.ClipSkip.StopAtLayer, -24, -1),
				"clip":               buildWorkflowLink(checkpointNodeID, 1),
			},
			Meta: map[string]any{
				"title": "CLIP Set Last Layer",
			},
		}
		clipInputLink = buildWorkflowLink(clipSkipNodeID, 0)
	}

	positiveNode.Inputs["clip"] = clipInputLink
	negativeNode.Inputs["clip"] = clipInputLink
	graph[positiveNodeID] = positiveNode
	graph[negativeNodeID] = negativeNode

	decodeNodeID, err := findNodeByTitle(graph, "VAE Decode", "VAEDecode")
	if err != nil {
		return err
	}
	decodeNode := graph[decodeNodeID]

	if strings.TrimSpace(req.VAE) != "" && !strings.EqualFold(strings.TrimSpace(req.VAE), "auto") {
		vaeNodeID, err := findNodeByTitle(graph, "Load VAE", "VAELoader")
		if err == nil {
			vaeNode := graph[vaeNodeID]
			vaeNode.Inputs["vae_name"] = strings.TrimSpace(req.VAE)
			graph[vaeNodeID] = vaeNode
			decodeNode.Inputs["vae"] = buildWorkflowLink(vaeNodeID, 0)
		}
	} else {
		decodeNode.Inputs["vae"] = buildWorkflowLink(checkpointNodeID, 2)
	}

	finalSamplesNodeID := ksamplerNodeID
	if req.Refine.Enabled {
		refineLatentInputNodeID := ""
		switch req.Refine.UpscaleMode {
		case "model":
			upscaleModel := strings.TrimSpace(req.Refine.UpscaleModel)
			if upscaleModel == "" {
				return fmt.Errorf("refine upscale model is required when using model mode")
			}

			preRefineDecodeNodeID := nextWorkflowNodeID(graph)
			graph[preRefineDecodeNodeID] = comfyWorkflowNode{
				ClassType: "VAEDecode",
				Inputs: map[string]any{
					"samples": buildWorkflowLink(ksamplerNodeID, 0),
					"vae":     decodeNode.Inputs["vae"],
				},
				Meta: map[string]any{
					"title": "Refine Decode",
				},
			}

			upscaleNodeID := nextWorkflowNodeID(graph)
			graph[upscaleNodeID] = comfyWorkflowNode{
				ClassType: "PixoraImageUpscaler",
				Inputs: map[string]any{
					"image":          buildWorkflowLink(preRefineDecodeNodeID, 0),
					"upscale_model":  upscaleModel,
					"multiplier":     clampFloat(req.Refine.ScaleBy, 1.05, 4),
					"upscale_method": req.Refine.UpscaleMethod,
				},
				Meta: map[string]any{
					"title": "Refine Upscale Image",
				},
			}

			encodeNodeID := nextWorkflowNodeID(graph)
			graph[encodeNodeID] = comfyWorkflowNode{
				ClassType: "VAEEncode",
				Inputs: map[string]any{
					"pixels": buildWorkflowLink(upscaleNodeID, 0),
					"vae":    decodeNode.Inputs["vae"],
				},
				Meta: map[string]any{
					"title": "Refine VAE Encode",
				},
			}

			refineLatentInputNodeID = encodeNodeID
		default:
			upscaleNodeID := nextWorkflowNodeID(graph)
			graph[upscaleNodeID] = comfyWorkflowNode{
				ClassType: "LatentUpscaleBy",
				Inputs: map[string]any{
					"upscale_method": req.Refine.UpscaleMethod,
					"scale_by":       clampFloat(req.Refine.ScaleBy, 1.05, 4),
					"samples":        buildWorkflowLink(ksamplerNodeID, 0),
				},
				Meta: map[string]any{
					"title": "Refine Upscale Latent",
				},
			}
			refineLatentInputNodeID = upscaleNodeID
		}

		refineSamplerNodeID := nextWorkflowNodeID(graph)
		refineSeed := seedValue + 1
		graph[refineSamplerNodeID] = comfyWorkflowNode{
			ClassType: "KSampler",
			Inputs: map[string]any{
				"seed":         refineSeed,
				"steps":        clampInt(req.Refine.Steps, 1, 80),
				"cfg":          clampFloat(req.CFGScale, 1, 30),
				"sampler_name": strings.TrimSpace(req.Sampler),
				"scheduler":    strings.TrimSpace(req.Scheduler),
				"denoise":      clampFloat(req.Refine.DenoiseStrength, 0.05, 1),
				"model":        buildWorkflowLink(checkpointNodeID, 0),
				"positive":     buildWorkflowLink(positiveNodeID, 0),
				"negative":     buildWorkflowLink(negativeNodeID, 0),
				"latent_image": buildWorkflowLink(refineLatentInputNodeID, 0),
			},
			Meta: map[string]any{
				"title": "Refine KSampler",
			},
		}

		finalSamplesNodeID = refineSamplerNodeID
	}

	decodeNode.Inputs["samples"] = buildWorkflowLink(finalSamplesNodeID, 0)
	graph[decodeNodeID] = decodeNode

	finalImageNodeID := decodeNodeID
	if req.FaceDetailer.Enabled {
		if strings.TrimSpace(req.FaceDetailer.BboxModel) == "" {
			return fmt.Errorf("face detailer requires bbox model selection")
		}
		if strings.TrimSpace(req.FaceDetailer.SAMModel) == "" {
			return fmt.Errorf("face detailer requires SAM model selection")
		}

		if modelsErr != nil {
			return fmt.Errorf("resolve models root for face detailer models: %w", modelsErr)
		}
		if _, err := resolveBBoxModelFile(modelsRoot, req.FaceDetailer.BboxModel); err != nil {
			return err
		}
		if _, err := resolveSAMModelFile(modelsRoot, req.FaceDetailer.SAMModel); err != nil {
			return err
		}

		bboxProviderNodeID := nextWorkflowNodeID(graph)
		graph[bboxProviderNodeID] = comfyWorkflowNode{
			ClassType: "PixoraFaceBBoxDetectorProvider",
			Inputs: map[string]any{
				"bbox_model_name": strings.TrimSpace(req.FaceDetailer.BboxModel),
			},
			Meta: map[string]any{
				"title": "Face BBox Detector Provider",
			},
		}

		samLoaderNodeID := nextWorkflowNodeID(graph)
		graph[samLoaderNodeID] = comfyWorkflowNode{
			ClassType: "PixoraLoadSAMModel",
			Inputs: map[string]any{
				"sam_model_name": strings.TrimSpace(req.FaceDetailer.SAMModel),
			},
			Meta: map[string]any{
				"title": "Pixora Load SAM Model",
			},
		}

		faceDetailerNodeID := nextWorkflowNodeID(graph)
		graph[faceDetailerNodeID] = comfyWorkflowNode{
			ClassType: "PixoraFaceDetailer",
			Inputs: map[string]any{
				"image":                      buildWorkflowLink(decodeNodeID, 0),
				"model":                      buildWorkflowLink(checkpointNodeID, 0),
				"clip":                       clipInputLink,
				"vae":                        decodeNode.Inputs["vae"],
				"guide_size":                 req.FaceDetailer.GuideSize,
				"guide_size_for":             req.FaceDetailer.GuideSizeFor,
				"max_size":                   req.FaceDetailer.MaxSize,
				"seed":                       seedValue,
				"steps":                      clampInt(req.Steps, 1, 200),
				"cfg":                        clampFloat(req.CFGScale, 1, 30),
				"sampler_name":               strings.TrimSpace(req.Sampler),
				"scheduler":                  strings.TrimSpace(req.Scheduler),
				"positive":                   buildWorkflowLink(positiveNodeID, 0),
				"negative":                   buildWorkflowLink(negativeNodeID, 0),
				"denoise":                    req.FaceDetailer.Denoise,
				"feather":                    req.FaceDetailer.Feather,
				"noise_mask":                 req.FaceDetailer.NoiseMask,
				"force_inpaint":              req.FaceDetailer.ForceInpaint,
				"inpaint_model":              req.FaceDetailer.InpaintModel,
				"noise_mask_feather":         req.FaceDetailer.NoiseMaskFeather,
				"bbox_threshold":             req.FaceDetailer.BboxThreshold,
				"bbox_dilation":              req.FaceDetailer.BboxDilation,
				"bbox_crop_factor":           req.FaceDetailer.BboxCropFactor,
				"sam_model_opt":              buildWorkflowLink(samLoaderNodeID, 0),
				"sam_detection_hint":         req.FaceDetailer.SAMDetectionHint,
				"sam_dilation":               req.FaceDetailer.SAMDilation,
				"sam_threshold":              req.FaceDetailer.SAMThreshold,
				"sam_bbox_expansion":         req.FaceDetailer.SAMBboxExpansion,
				"sam_mask_hint_threshold":    req.FaceDetailer.SAMMaskHintThreshold,
				"sam_mask_hint_use_negative": req.FaceDetailer.SAMMaskHintUseNegative,
				"drop_size":                  req.FaceDetailer.DropSize,
				"bbox_detector":              buildWorkflowLink(bboxProviderNodeID, 0),
				"wildcard":                   "",
				"cycle":                      req.FaceDetailer.Cycle,
				"tiled_encode":               req.FaceDetailer.TiledEncode,
				"tiled_decode":               req.FaceDetailer.TiledDecode,
			},
			Meta: map[string]any{
				"title": "Pixora Face Detailer",
			},
		}

		finalImageNodeID = faceDetailerNodeID
	}

	saveNodeID, err := findNodeByTitle(graph, "Pixora Save Image", "PixoraSaveImage")
	if err != nil {
		return err
	}
	saveNode := graph[saveNodeID]
	saveNode.Inputs["sub_directory"] = outputDir
	saveNode.Inputs["filename_prefix"] = "Pixora"
	saveNode.Inputs["images"] = buildWorkflowLink(finalImageNodeID, 0)
	graph[saveNodeID] = saveNode

	return nil
}

func normalizeRefineUpscaleMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "model":
		return "model"
	default:
		return "latent"
	}
}

func normalizeRefineUpscaleMethod(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "bilinear", "area", "bicubic", "bislerp", "lanczos":
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return "nearest-exact"
	}
}

func normalizeSAMDetectionHint(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "center-1", "horizontal-2", "vertical-2", "rect-4", "diamond-4", "mask-area", "mask-points", "mask-point-bbox", "none":
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return "none"
	}
}

func normalizeSAMMaskHintUseNegative(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "small":
		return "Small"
	case "outter", "outer":
		return "Outter"
	default:
		return "False"
	}
}

func resolveBBoxModelFile(modelsRoot string, modelName string) (string, error) {
	trimmedName := strings.TrimSpace(modelName)
	if trimmedName == "" {
		return "", fmt.Errorf("bbox model is required")
	}

	ext := strings.ToLower(filepath.Ext(trimmedName))
	if ext != ".pt" && ext != ".onnx" {
		return "", fmt.Errorf("invalid bbox model '%s': expected .pt or .onnx file", trimmedName)
	}

	bboxRoot := filepath.Join(modelsRoot, "bbox")
	if info, err := os.Stat(bboxRoot); err != nil || !info.IsDir() {
		if err != nil {
			return "", fmt.Errorf("bbox models directory not found at '%s': %w", bboxRoot, err)
		}
		return "", fmt.Errorf("bbox models directory not found at '%s'", bboxRoot)
	}

	name := filepath.FromSlash(trimmedName)
	base := filepath.Base(name)
	var candidates []string
	if filepath.IsAbs(name) {
		candidates = append(candidates, filepath.Clean(name))
	} else {
		if filepath.Dir(name) == "." {
			candidates = append(candidates,
				filepath.Join(modelsRoot, "bbox", base),
				filepath.Join(modelsRoot, "ultralytics", "bbox", base),
				filepath.Join(modelsRoot, base),
			)
		} else {
			candidates = append(candidates,
				filepath.Join(modelsRoot, name),
				filepath.Join(modelsRoot, "ultralytics", name),
				filepath.Join(modelsRoot, "bbox", base),
			)
		}
	}

	checked := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		resolved := filepath.Clean(candidate)
		checked = append(checked, resolved)
		if _, err := os.Stat(resolved); err == nil {
			return resolved, nil
		} else if !os.IsNotExist(err) {
			return "", fmt.Errorf("failed to stat bbox model '%s': %w", resolved, err)
		}
	}

	return "", fmt.Errorf(
		"bbox model '%s' was not found in %s (checked: %s)",
		filepath.Base(trimmedName),
		bboxRoot,
		strings.Join(checked, ", "),
	)
}

func resolveSAMModelFile(modelsRoot string, modelName string) (string, error) {
	trimmedName := strings.TrimSpace(modelName)
	if trimmedName == "" {
		return "", nil
	}

	if strings.ToLower(filepath.Ext(trimmedName)) != ".pth" {
		return "", fmt.Errorf("invalid SAM model '%s': expected .pth file", trimmedName)
	}

	samRoot := filepath.Join(modelsRoot, "sams")
	if info, err := os.Stat(samRoot); err != nil || !info.IsDir() {
		if err != nil {
			return "", fmt.Errorf("SAM models directory not found at '%s': %w", samRoot, err)
		}
		return "", fmt.Errorf("SAM models directory not found at '%s'", samRoot)
	}

	resolved := filepath.Join(samRoot, filepath.Base(trimmedName))
	if _, err := os.Stat(resolved); err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("SAM model '%s' was not found in %s", filepath.Base(trimmedName), samRoot)
		}
		return "", fmt.Errorf("failed to stat SAM model '%s': %w", resolved, err)
	}

	return resolved, nil
}

func nextWorkflowNodeID(graph map[string]comfyWorkflowNode) string {
	next := 1
	for nodeID := range graph {
		parsed, err := strconv.Atoi(strings.TrimSpace(nodeID))
		if err != nil {
			continue
		}
		if parsed >= next {
			next = parsed + 1
		}
	}
	return strconv.Itoa(next)
}

func buildWorkflowLink(nodeID string, outputIndex int) []any {
	return []any{nodeID, outputIndex}
}

func findNodeByTitle(graph map[string]comfyWorkflowNode, title string, classType string) (string, error) {
	for id := range graph {
		node := graph[id]
		if classType != "" && !strings.EqualFold(strings.TrimSpace(node.ClassType), strings.TrimSpace(classType)) {
			continue
		}

		nodeTitle := ""
		if node.Meta != nil {
			if rawTitle, ok := node.Meta["title"]; ok {
				if asString, ok := rawTitle.(string); ok {
					nodeTitle = asString
				}
			}
		}

		if strings.EqualFold(strings.TrimSpace(nodeTitle), strings.TrimSpace(title)) {
			return id, nil
		}
	}

	return "", fmt.Errorf("workflow node not found: title=%s class=%s", title, classType)
}

func resolveGenerationOutputDir(cfg config.ComfyUIBackendConfig, mode string) (string, error) {
	resolved, err := resolveGenerationOutputDirPath(cfg, mode)
	if err != nil {
		return "", err
	}

	if err := os.MkdirAll(resolved, 0755); err != nil {
		return "", fmt.Errorf("create output directory: %w", err)
	}

	return resolved, nil
}

func resolveGenerationOutputDirPath(cfg config.ComfyUIBackendConfig, mode string) (string, error) {
	runtimeRoot, err := resolveRuntimeRoot(cfg.RootDir)
	if err != nil {
		return "", fmt.Errorf("resolve runtime root: %w", err)
	}

	baseOutput := strings.TrimSpace(cfg.OutputDir)
	if baseOutput == "" {
		baseOutput = filepath.Join("data", "output")
	}

	if !filepath.IsAbs(baseOutput) {
		baseOutput = filepath.Join(runtimeRoot, baseOutput)
	}

	subDir := "text2img"
	if strings.EqualFold(mode, "img2img") {
		subDir = "img2img"
	}

	return filepath.Join(baseOutput, subDir), nil
}

type generationSeedConfig struct {
	BaseSeed          int64
	UseVariation      bool
	VariationSeed     int64
	VariationStrength float64
}

func resolveGenerationSeeds(raw string, variationRaw string, variationStrength float64) generationSeedConfig {
	baseSeed, _ := resolveInputSeed(raw, false)
	strength := clampFloat(variationStrength, 0, 1)
	if strength <= 0 {
		return generationSeedConfig{BaseSeed: baseSeed}
	}

	variationSeed, hasVariationSeed := resolveInputSeed(variationRaw, true)
	if !hasVariationSeed {
		return generationSeedConfig{BaseSeed: baseSeed}
	}

	return generationSeedConfig{
		BaseSeed:          baseSeed,
		UseVariation:      true,
		VariationSeed:     variationSeed,
		VariationStrength: strength,
	}
}

func parseGenerationSeed(raw string) (int64, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, false
	}

	parsed, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil {
		return 0, false
	}

	return parsed, true
}

func resolveInputSeed(raw string, allowRandomSentinel bool) (int64, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		if allowRandomSentinel {
			return 0, false
		}
		return generateRandomSeed(), true
	}

	if allowRandomSentinel && trimmed == "-1" {
		return generateRandomSeed(), true
	}

	parsed, ok := parseGenerationSeed(trimmed)
	if !ok {
		return generateRandomSeed(), true
	}

	if parsed < 0 {
		return generateRandomSeed(), true
	}

	return parsed, true
}

func generateRandomSeed() int64 {
	var buffer [8]byte
	if _, err := rand.Read(buffer[:]); err == nil {
		seed := binary.LittleEndian.Uint64(buffer[:]) & uint64(math.MaxInt64)
		if seed == 0 {
			seed = 1
		}
		return int64(seed)
	}

	fallback := uint64(time.Now().UnixNano())
	fallback ^= fallback << 13
	fallback ^= fallback >> 7
	fallback ^= fallback << 17
	fallback &= uint64(math.MaxInt64)
	if fallback == 0 {
		fallback = 1
	}

	return int64(fallback)
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func clampFloat(value float64, min float64, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
