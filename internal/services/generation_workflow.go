package services

import (
	"encoding/json"
	"fmt"
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

	resolvedSeed := resolveGenerationSeed(req.Seed)
	if err := injectTxt2ImgWorkflow(workflow, req, resolvedSeed, outputDir); err != nil {
		return nil, "", err
	}

	return &WorkflowPreview{
		Mode:         mode,
		Prompt:       workflow,
		OutputDir:    outputDir,
		ResolvedSeed: resolvedSeed,
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

func injectTxt2ImgWorkflow(graph map[string]comfyWorkflowNode, req GenerationRequest, seed string, outputDir string) error {
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
	seedValue, parseErr := strconv.ParseInt(seed, 10, 64)
	if parseErr != nil {
		seedValue = time.Now().UnixNano()
	}
	ksamplerNode.Inputs["seed"] = seedValue
	ksamplerNode.Inputs["steps"] = clampInt(req.Steps, 1, 200)
	ksamplerNode.Inputs["cfg"] = clampFloat(req.CFGScale, 1, 30)
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
	emptyLatentNode.Inputs["batch_size"] = 1
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
	graph[decodeNodeID] = decodeNode

	saveNodeID, err := findNodeByTitle(graph, "Pixora Save Image", "PixoraSaveImage")
	if err != nil {
		return err
	}
	saveNode := graph[saveNodeID]
	saveNode.Inputs["sub_directory"] = outputDir
	saveNode.Inputs["filename_prefix"] = "Pixora"
	graph[saveNodeID] = saveNode

	return nil
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

func resolveGenerationSeed(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return strconv.FormatInt(time.Now().UnixNano(), 10)
	}

	if _, err := strconv.ParseInt(trimmed, 10, 64); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 10)
	}

	return trimmed
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
