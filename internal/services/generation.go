package services

import (
	"fmt"
	"os"
	"path/filepath"
	"pixora/internal/config"
	"sort"
	"strings"
)

var checkpointLikeExtensions = map[string]struct{}{
	".safetensor":  {},
	".safetensors": {},
	".ckpt":        {},
	".pt":          {},
	".pth":         {},
	".bin":         {},
}

var upscaleModelExtensions = map[string]struct{}{
	".safetensor":  {},
	".safetensors": {},
	".pt":          {},
	".pth":         {},
	".onnx":        {},
	".bin":         {},
}

var textEncoderExtensions = map[string]struct{}{
	".safetensor":  {},
	".safetensors": {},
	".pt":          {},
	".pth":         {},
	".bin":         {},
	".gguf":        {},
}

type GenerationModelCatalog struct {
	Samplers        []string `json:"samplers"`
	Checkpoints     []string `json:"checkpoints"`
	VAEs            []string `json:"vaes"`
	Loras           []string `json:"loras"`
	ControlNets     []string `json:"controlnets"`
	UpscaleModels   []string `json:"upscaleModels"`
	TextEncoders    []string `json:"textEncoders"`
	DiffusionModels []string `json:"diffusionModels"`
	Unets           []string `json:"unets"`
}

type GenerationService struct {
	config *config.Manager
}

func NewGenerationService(cfg *config.Manager) *GenerationService {
	return &GenerationService{config: cfg}
}

func (s *GenerationService) GetModelCatalog() (*GenerationModelCatalog, error) {
	if s.config == nil {
		return nil, fmt.Errorf("missing config manager")
	}

	comfyCfg := s.config.GetComfyUIConfig()
	runtimeRoot, err := resolveRuntimeRoot(comfyCfg.RootDir)
	if err != nil {
		return nil, fmt.Errorf("resolve runtime root: %w", err)
	}

	modelsRoot := filepath.Join(runtimeRoot, "data", "sd")
	if _, err := os.Stat(modelsRoot); err != nil {
		if os.IsNotExist(err) {
			return &GenerationModelCatalog{Samplers: defaultSamplers()}, nil
		}
		return nil, fmt.Errorf("stat models root: %w", err)
	}

	catalog := &GenerationModelCatalog{
		Samplers:        defaultSamplers(),
		Checkpoints:     listModelFiles(filepath.Join(modelsRoot, "checkpoints"), checkpointLikeExtensions),
		VAEs:            listModelFiles(filepath.Join(modelsRoot, "vae"), checkpointLikeExtensions),
		Loras:           listModelFiles(filepath.Join(modelsRoot, "loras"), checkpointLikeExtensions),
		ControlNets:     listModelFiles(filepath.Join(modelsRoot, "controlnet"), checkpointLikeExtensions),
		UpscaleModels:   listModelFiles(filepath.Join(modelsRoot, "upscale_models"), upscaleModelExtensions),
		TextEncoders:    uniqueAndSorted(append(listModelFiles(filepath.Join(modelsRoot, "text_encoders"), textEncoderExtensions), listModelFiles(filepath.Join(modelsRoot, "clip"), textEncoderExtensions)...)),
		DiffusionModels: listModelFiles(filepath.Join(modelsRoot, "diffusion_models"), checkpointLikeExtensions),
		Unets:           listModelFiles(filepath.Join(modelsRoot, "unet"), checkpointLikeExtensions),
	}

	if len(catalog.VAEs) == 0 {
		catalog.VAEs = []string{"Auto"}
	} else {
		catalog.VAEs = append([]string{"Auto"}, catalog.VAEs...)
	}

	return catalog, nil
}

func defaultSamplers() []string {
	return []string{
		"Euler a",
		"Euler",
		"Heun",
		"DPM++ 2M Karras",
		"DPM++ SDE Karras",
		"DPM++ 2S a Karras",
		"DPM2 a Karras",
		"LMS Karras",
	}
}

func listModelFiles(root string, allowedExtensions map[string]struct{}) []string {
	if root == "" {
		return []string{}
	}

	if _, err := os.Stat(root); err != nil {
		return []string{}
	}

	files := make([]string, 0)

	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}

		if entry.IsDir() {
			return nil
		}

		name := strings.TrimSpace(entry.Name())
		if name == "" || strings.HasPrefix(name, ".") {
			return nil
		}

		if !hasAllowedExtension(name, allowedExtensions) {
			return nil
		}

		relPath, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}

		files = append(files, filepath.ToSlash(relPath))
		return nil
	})

	return uniqueAndSorted(files)
}

func hasAllowedExtension(fileName string, allowedExtensions map[string]struct{}) bool {
	if len(allowedExtensions) == 0 {
		return true
	}

	extension := strings.ToLower(strings.TrimSpace(filepath.Ext(fileName)))
	if extension == "" {
		return false
	}

	_, ok := allowedExtensions[extension]
	return ok
}

func uniqueAndSorted(items []string) []string {
	if len(items) == 0 {
		return []string{}
	}

	seen := make(map[string]struct{}, len(items))
	unique := make([]string, 0, len(items))
	for _, item := range items {
		normalized := strings.TrimSpace(item)
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		unique = append(unique, normalized)
	}

	sort.Slice(unique, func(i int, j int) bool {
		return strings.ToLower(unique[i]) < strings.ToLower(unique[j])
	})

	return unique
}
