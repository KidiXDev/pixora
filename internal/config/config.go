package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type ScanMode string

const (
	ScanModeNormal ScanMode = "normal"
	ScanModeWalk   ScanMode = "walk"
)

type FolderConfig struct {
	Path     string   `json:"path"`
	ScanMode ScanMode `json:"scanMode"`
	Alias    string   `json:"alias"`
}

type TabConfig struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Path   string `json:"path"` // empty means all
	IsWalk bool   `json:"isWalk"`
}

type WindowBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type WindowConfig struct {
	State           string       `json:"state"`
	Bounds          WindowBounds `json:"bounds"`
	HasBounds       bool         `json:"hasBounds"`
	NormalBounds    WindowBounds `json:"normalBounds"`
	HasNormalBounds bool         `json:"hasNormalBounds"`
}

type ComfyUIBackendConfig struct {
	RootDir              string `json:"rootDir"`
	PythonPath           string `json:"pythonPath"`
	MainScriptPath       string `json:"mainScriptPath"`
	Args                 string `json:"args"`
	CrossAttentionMethod string `json:"crossAttentionMethod"`
	OutputDir            string `json:"outputDir"`
	ModelPathsYAML       string `json:"modelPathsYAML"`
	Host                 string `json:"host"`
	Port                 int    `json:"port"`
}

type AutocompleteConfig struct {
	Enabled       bool   `json:"enabled"`
	Source        string `json:"source"`
	Suffix        string `json:"suffix"`
	MatchMode     string `json:"matchMode"`
	SpacingMode   string `json:"spacingMode"`
	SortMode      string `json:"sortMode"`
	Whitespace    bool   `json:"whitespace"`
	EscapeParens  bool   `json:"escapeParens"`
	SuggestionCap int    `json:"suggestionCap"`
}

type PromptFormatConfig struct {
	CollapseMultiline  bool   `json:"collapseMultiline"`
	CollapseWhitespace bool   `json:"collapseWhitespace"`
	CommaSpacingMode   string `json:"commaSpacingMode"`
}

type GenerationPanelResolution struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type GenerationPanelRefine struct {
	Enabled         bool    `json:"enabled"`
	UpscaleMode     string  `json:"upscaleMode"`
	UpscaleMethod   string  `json:"upscaleMethod"`
	UpscaleModel    string  `json:"upscaleModel"`
	ScaleBy         float64 `json:"scaleBy"`
	Steps           int     `json:"steps"`
	DenoiseStrength float64 `json:"denoiseStrength"`
}

type GenerationPanelClipSkip struct {
	Enabled     bool `json:"enabled"`
	StopAtLayer int  `json:"stopAtLayer"`
}

type GenerationPanelFaceDetailer struct {
	Enabled                bool    `json:"enabled"`
	GuideSize              int     `json:"guideSize"`
	GuideSizeFor           bool    `json:"guideSizeFor"`
	MaxSize                int     `json:"maxSize"`
	Denoise                float64 `json:"denoise"`
	Feather                int     `json:"feather"`
	NoiseMask              bool    `json:"noiseMask"`
	ForceInpaint           bool    `json:"forceInpaint"`
	InpaintModel           bool    `json:"inpaintModel"`
	NoiseMaskFeather       int     `json:"noiseMaskFeather"`
	BboxThreshold          float64 `json:"bboxThreshold"`
	BboxDilation           int     `json:"bboxDilation"`
	BboxCropFactor         float64 `json:"bboxCropFactor"`
	BboxModel              string  `json:"bboxModel"`
	SAMModel               string  `json:"samModel"`
	SAMDetectionHint       string  `json:"samDetectionHint"`
	SAMDilation            int     `json:"samDilation"`
	SAMThreshold           float64 `json:"samThreshold"`
	SAMBboxExpansion       int     `json:"samBboxExpansion"`
	SAMMaskHintThreshold   float64 `json:"samMaskHintThreshold"`
	SAMMaskHintUseNegative string  `json:"samMaskHintUseNegative"`
	DropSize               int     `json:"dropSize"`
	Cycle                  int     `json:"cycle"`
	TiledEncode            bool    `json:"tiledEncode"`
	TiledDecode            bool    `json:"tiledDecode"`
}

type GenerationPanelTxt2Img struct {
	Prompt                string                      `json:"prompt"`
	NegativePrompt        string                      `json:"negativePrompt"`
	Seed                  string                      `json:"seed"`
	VariationSeed         string                      `json:"variationSeed"`
	VariationSeedStrength float64                     `json:"variationSeedStrength"`
	Steps                 int                         `json:"steps"`
	CFGScale              float64                     `json:"cfgScale"`
	Resolution            GenerationPanelResolution   `json:"resolution"`
	Model                 string                      `json:"model"`
	VAE                   string                      `json:"vae"`
	Sampler               string                      `json:"sampler"`
	Scheduler             string                      `json:"scheduler"`
	BatchSize             int                         `json:"batchSize"`
	Refine                GenerationPanelRefine       `json:"refine"`
	ClipSkip              GenerationPanelClipSkip     `json:"clipSkip"`
	FaceDetailer          GenerationPanelFaceDetailer `json:"faceDetailer"`
}

type GenerationPanelImg2Img struct {
	Prompt                string                    `json:"prompt"`
	NegativePrompt        string                    `json:"negativePrompt"`
	Seed                  string                    `json:"seed"`
	VariationSeed         string                    `json:"variationSeed"`
	VariationSeedStrength float64                   `json:"variationSeedStrength"`
	Steps                 int                       `json:"steps"`
	CFGScale              float64                   `json:"cfgScale"`
	Resolution            GenerationPanelResolution `json:"resolution"`
	Model                 string                    `json:"model"`
	VAE                   string                    `json:"vae"`
	Sampler               string                    `json:"sampler"`
	Scheduler             string                    `json:"scheduler"`
	SourceImagePath       string                    `json:"sourceImagePath"`
	BatchSize             int                       `json:"batchSize"`
	DenoiseStrength       float64                   `json:"denoiseStrength"`
}

type GenerationPanelHistoryItem struct {
	ID           string                    `json:"id"`
	Backend      string                    `json:"backend"`
	Mode         string                    `json:"mode"`
	Prompt       string                    `json:"prompt"`
	CreatedAtISO string                    `json:"createdAtISO"`
	Resolution   GenerationPanelResolution `json:"resolution"`
	Steps        int                       `json:"steps"`
	CFGScale     float64                   `json:"cfgScale"`
	Seed         string                    `json:"seed"`
}

type GenerationPanelConfig struct {
	ActiveBackend   string                       `json:"activeBackend"`
	Mode            string                       `json:"mode"`
	Txt2Img         GenerationPanelTxt2Img       `json:"txt2img"`
	Img2Img         GenerationPanelImg2Img       `json:"img2img"`
	History         []GenerationPanelHistoryItem `json:"history"`
	GenerateForever bool                         `json:"generateForever"`
}

type AppConfig struct {
	Folders      []FolderConfig        `json:"folders"`
	Tabs         []TabConfig           `json:"tabs"`
	Window       WindowConfig          `json:"window"`
	DevMode      bool                  `json:"devMode"`
	ComfyUI      ComfyUIBackendConfig  `json:"comfyUI"`
	Autocomplete AutocompleteConfig    `json:"autocomplete"`
	PromptFormat PromptFormatConfig    `json:"promptFormat"`
	Generation   GenerationPanelConfig `json:"generation"`
}

type Manager struct {
	configPath string
	config     AppConfig
	mu         sync.RWMutex
}

func NewManager() (*Manager, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}

	pixoraDir := filepath.Join(configDir, "pixora")
	if err := os.MkdirAll(pixoraDir, 0755); err != nil {
		return nil, err
	}

	configPath := filepath.Join(pixoraDir, "config.json")
	m := &Manager{
		configPath: configPath,
		config: AppConfig{
			Folders: []FolderConfig{},
			Tabs:    []TabConfig{},
			Window: WindowConfig{
				State: "normal",
			},
		},
	}

	if err := m.Load(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	return m, nil
}

func (m *Manager) Load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := os.ReadFile(m.configPath)
	if err != nil {
		return err
	}

	if err := json.Unmarshal(data, &m.config); err != nil {
		return err
	}

	m.ensureDefaultsLocked()
	return nil
}

func (m *Manager) Save() error {
	m.mu.RLock()
	defer m.mu.RUnlock()

	data, err := json.MarshalIndent(m.config, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(m.configPath, data, 0644)
}

func (m *Manager) GetConfig() AppConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.config
}

func (m *Manager) SetWindow(window WindowConfig) error {
	m.mu.Lock()
	m.config.Window = window
	m.mu.Unlock()

	return m.Save()
}

func (m *Manager) GetComfyUIConfig() ComfyUIBackendConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.config.ComfyUI
}

func (m *Manager) SetComfyUIConfig(cfg ComfyUIBackendConfig) error {
	m.mu.Lock()
	m.config.ComfyUI = cfg
	m.ensureDefaultsLocked()
	m.mu.Unlock()

	return m.Save()
}

func (m *Manager) SetAutocompleteConfig(cfg AutocompleteConfig) error {
	m.mu.Lock()
	m.config.Autocomplete = cfg
	m.ensureDefaultsLocked()
	m.mu.Unlock()

	return m.Save()
}

func (m *Manager) SetPromptFormatConfig(cfg PromptFormatConfig) error {
	m.mu.Lock()
	m.config.PromptFormat = cfg
	m.ensureDefaultsLocked()
	m.mu.Unlock()

	return m.Save()
}

func (m *Manager) GetGenerationPanelConfig() GenerationPanelConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.config.Generation
}

func (m *Manager) SetGenerationPanelConfig(cfg GenerationPanelConfig) error {
	m.mu.Lock()
	m.config.Generation = cfg
	m.ensureDefaultsLocked()
	m.mu.Unlock()

	return m.Save()
}

func (m *Manager) AddFolder(path string, mode ScanMode) error {
	m.mu.Lock()
	exists := false
	for i, f := range m.config.Folders {
		if f.Path == path {
			m.config.Folders[i].ScanMode = mode
			exists = true
			break
		}
	}
	if !exists {
		m.config.Folders = append(m.config.Folders, FolderConfig{Path: path, ScanMode: mode})
	}
	m.mu.Unlock()

	return m.Save()
}

func (m *Manager) SetDevMode(enabled bool) error {
	m.mu.Lock()
	m.config.DevMode = enabled
	m.mu.Unlock()
	return m.Save()
}

func (m *Manager) RemoveFolder(path string) error {
	m.mu.Lock()
	var newFolders []FolderConfig
	for _, f := range m.config.Folders {
		if f.Path != path {
			newFolders = append(newFolders, f)
		}
	}
	m.config.Folders = newFolders
	m.mu.Unlock()

	return m.Save()
}

func (m *Manager) SetTabs(tabs []TabConfig) error {
	m.mu.Lock()
	m.config.Tabs = tabs
	m.mu.Unlock()
	return m.Save()
}

func (m *Manager) UpdateFolderAlias(path string, alias string) error {
	m.mu.Lock()
	for i, f := range m.config.Folders {
		if f.Path == path {
			m.config.Folders[i].Alias = alias
			break
		}
	}
	m.mu.Unlock()
	return m.Save()
}

func (m *Manager) ensureDefaultsLocked() {
	if m.config.Folders == nil {
		m.config.Folders = []FolderConfig{}
	}

	if m.config.Tabs == nil {
		m.config.Tabs = []TabConfig{}
	}

	if m.config.Window.State == "" {
		m.config.Window.State = "normal"
	}

	if m.config.Window.HasBounds {
		if m.config.Window.Bounds.Width <= 0 || m.config.Window.Bounds.Height <= 0 {
			m.config.Window.HasBounds = false
			m.config.Window.Bounds = WindowBounds{}
		}
	} else if m.config.Window.Bounds.Width > 0 && m.config.Window.Bounds.Height > 0 {
		m.config.Window.HasBounds = true
	}

	if m.config.Window.HasNormalBounds {
		if m.config.Window.NormalBounds.Width <= 0 || m.config.Window.NormalBounds.Height <= 0 {
			m.config.Window.HasNormalBounds = false
			m.config.Window.NormalBounds = WindowBounds{}
		}
	} else if m.config.Window.NormalBounds.Width > 0 && m.config.Window.NormalBounds.Height > 0 {
		m.config.Window.HasNormalBounds = true
	}

	if m.config.ComfyUI.Host == "" {
		m.config.ComfyUI.Host = "127.0.0.1"
	}

	if m.config.ComfyUI.Port <= 0 {
		m.config.ComfyUI.Port = 7180
	}

	if m.config.ComfyUI.Args == "" {
		m.config.ComfyUI.Args = "--listen 127.0.0.1 --port 7180 --normalvram --preview-method auto --use-pytorch-cross-attention --enable-manager"
	}

	m.config.ComfyUI.CrossAttentionMethod = normalizeCrossAttentionMethod(m.config.ComfyUI.CrossAttentionMethod)

	if m.config.ComfyUI.OutputDir == "" {
		m.config.ComfyUI.OutputDir = filepath.Join("data", "output")
	}

	if m.config.Generation.ActiveBackend == "" {
		m.config.Generation.ActiveBackend = "comfyui"
	}

	if m.config.Generation.Mode != "txt2img" && m.config.Generation.Mode != "img2img" {
		m.config.Generation.Mode = "txt2img"
	}

	if m.config.Generation.Txt2Img.Steps <= 0 {
		m.config.Generation.Txt2Img.Steps = 28
	}

	if m.config.Generation.Txt2Img.CFGScale <= 0 {
		m.config.Generation.Txt2Img.CFGScale = 7
	}

	if m.config.Generation.Txt2Img.VariationSeedStrength < 0 || m.config.Generation.Txt2Img.VariationSeedStrength > 1 {
		m.config.Generation.Txt2Img.VariationSeedStrength = 0.35
	}

	if m.config.Generation.Txt2Img.Resolution.Width <= 0 {
		m.config.Generation.Txt2Img.Resolution.Width = 1024
	}

	if m.config.Generation.Txt2Img.Resolution.Height <= 0 {
		m.config.Generation.Txt2Img.Resolution.Height = 1024
	}

	if m.config.Generation.Txt2Img.BatchSize <= 0 {
		m.config.Generation.Txt2Img.BatchSize = 1
	}

	if m.config.Generation.Txt2Img.ClipSkip.StopAtLayer < -24 || m.config.Generation.Txt2Img.ClipSkip.StopAtLayer > -1 {
		m.config.Generation.Txt2Img.ClipSkip.StopAtLayer = -1
	}

	if m.config.Generation.Txt2Img.FaceDetailer.GuideSize <= 0 {
		m.config.Generation.Txt2Img.FaceDetailer.GuideSize = 512
	}
	m.config.Generation.Txt2Img.FaceDetailer.GuideSize = clampInt(m.config.Generation.Txt2Img.FaceDetailer.GuideSize, 64, 4096)
	if !m.config.Generation.Txt2Img.FaceDetailer.GuideSizeFor {
		m.config.Generation.Txt2Img.FaceDetailer.GuideSizeFor = true
	}

	if m.config.Generation.Txt2Img.FaceDetailer.MaxSize <= 0 {
		m.config.Generation.Txt2Img.FaceDetailer.MaxSize = 1024
	}
	m.config.Generation.Txt2Img.FaceDetailer.MaxSize = clampInt(m.config.Generation.Txt2Img.FaceDetailer.MaxSize, 64, 4096)

	if m.config.Generation.Txt2Img.FaceDetailer.Denoise <= 0 {
		m.config.Generation.Txt2Img.FaceDetailer.Denoise = 0.5
	}
	m.config.Generation.Txt2Img.FaceDetailer.Denoise = clampFloat(m.config.Generation.Txt2Img.FaceDetailer.Denoise, 0.0001, 1)

	m.config.Generation.Txt2Img.FaceDetailer.Feather = clampInt(m.config.Generation.Txt2Img.FaceDetailer.Feather, 0, 100)
	m.config.Generation.Txt2Img.FaceDetailer.NoiseMaskFeather = clampInt(m.config.Generation.Txt2Img.FaceDetailer.NoiseMaskFeather, 0, 100)

	if m.config.Generation.Txt2Img.FaceDetailer.BboxThreshold <= 0 {
		m.config.Generation.Txt2Img.FaceDetailer.BboxThreshold = 0.5
	}
	m.config.Generation.Txt2Img.FaceDetailer.BboxThreshold = clampFloat(m.config.Generation.Txt2Img.FaceDetailer.BboxThreshold, 0, 1)

	m.config.Generation.Txt2Img.FaceDetailer.BboxDilation = clampInt(m.config.Generation.Txt2Img.FaceDetailer.BboxDilation, -512, 512)

	if m.config.Generation.Txt2Img.FaceDetailer.BboxCropFactor <= 0 {
		m.config.Generation.Txt2Img.FaceDetailer.BboxCropFactor = 3
	}
	m.config.Generation.Txt2Img.FaceDetailer.BboxCropFactor = clampFloat(m.config.Generation.Txt2Img.FaceDetailer.BboxCropFactor, 1, 10)
	if strings.TrimSpace(m.config.Generation.Txt2Img.FaceDetailer.BboxModel) == "" {
		m.config.Generation.Txt2Img.FaceDetailer.BboxModel = "bbox/face_yolov8m.pt"
	}

	m.config.Generation.Txt2Img.FaceDetailer.SAMDetectionHint = NormalizeSAMDetectionHint(m.config.Generation.Txt2Img.FaceDetailer.SAMDetectionHint)
	m.config.Generation.Txt2Img.FaceDetailer.SAMDilation = clampInt(m.config.Generation.Txt2Img.FaceDetailer.SAMDilation, -512, 512)

	if m.config.Generation.Txt2Img.FaceDetailer.SAMThreshold <= 0 {
		m.config.Generation.Txt2Img.FaceDetailer.SAMThreshold = 0.93
	}
	m.config.Generation.Txt2Img.FaceDetailer.SAMThreshold = clampFloat(m.config.Generation.Txt2Img.FaceDetailer.SAMThreshold, 0, 1)

	m.config.Generation.Txt2Img.FaceDetailer.SAMBboxExpansion = clampInt(m.config.Generation.Txt2Img.FaceDetailer.SAMBboxExpansion, 0, 1000)

	if m.config.Generation.Txt2Img.FaceDetailer.SAMMaskHintThreshold <= 0 {
		m.config.Generation.Txt2Img.FaceDetailer.SAMMaskHintThreshold = 0.7
	}
	m.config.Generation.Txt2Img.FaceDetailer.SAMMaskHintThreshold = clampFloat(m.config.Generation.Txt2Img.FaceDetailer.SAMMaskHintThreshold, 0, 1)
	m.config.Generation.Txt2Img.FaceDetailer.SAMMaskHintUseNegative = NormalizeSAMMaskHintUseNegative(m.config.Generation.Txt2Img.FaceDetailer.SAMMaskHintUseNegative)

	if m.config.Generation.Txt2Img.FaceDetailer.DropSize <= 0 {
		m.config.Generation.Txt2Img.FaceDetailer.DropSize = 10
	}
	m.config.Generation.Txt2Img.FaceDetailer.DropSize = clampInt(m.config.Generation.Txt2Img.FaceDetailer.DropSize, 1, 4096)

	if m.config.Generation.Txt2Img.FaceDetailer.Cycle <= 0 {
		m.config.Generation.Txt2Img.FaceDetailer.Cycle = 1
	}
	m.config.Generation.Txt2Img.FaceDetailer.Cycle = clampInt(m.config.Generation.Txt2Img.FaceDetailer.Cycle, 1, 10)

	switch m.config.Generation.Txt2Img.Refine.UpscaleMode {
	case "latent", "model":
	default:
		m.config.Generation.Txt2Img.Refine.UpscaleMode = "latent"
	}

	switch m.config.Generation.Txt2Img.Refine.UpscaleMethod {
	case "nearest-exact", "bilinear", "area", "bicubic", "bislerp", "lanczos":
	default:
		m.config.Generation.Txt2Img.Refine.UpscaleMethod = "nearest-exact"
	}

	if m.config.Generation.Txt2Img.Refine.ScaleBy < 1.05 || m.config.Generation.Txt2Img.Refine.ScaleBy > 4 {
		m.config.Generation.Txt2Img.Refine.ScaleBy = 1.5
	}

	if m.config.Generation.Txt2Img.Refine.Steps <= 0 || m.config.Generation.Txt2Img.Refine.Steps > 80 {
		m.config.Generation.Txt2Img.Refine.Steps = 14
	}

	if m.config.Generation.Txt2Img.Refine.DenoiseStrength <= 0 || m.config.Generation.Txt2Img.Refine.DenoiseStrength > 1 {
		m.config.Generation.Txt2Img.Refine.DenoiseStrength = 0.35
	}

	if m.config.Generation.Img2Img.Steps <= 0 {
		m.config.Generation.Img2Img.Steps = m.config.Generation.Txt2Img.Steps
	}

	if m.config.Generation.Img2Img.CFGScale <= 0 {
		m.config.Generation.Img2Img.CFGScale = m.config.Generation.Txt2Img.CFGScale
	}

	if m.config.Generation.Img2Img.VariationSeedStrength < 0 || m.config.Generation.Img2Img.VariationSeedStrength > 1 {
		m.config.Generation.Img2Img.VariationSeedStrength = m.config.Generation.Txt2Img.VariationSeedStrength
	}

	if m.config.Generation.Img2Img.Resolution.Width <= 0 {
		m.config.Generation.Img2Img.Resolution.Width = m.config.Generation.Txt2Img.Resolution.Width
	}

	if m.config.Generation.Img2Img.Resolution.Height <= 0 {
		m.config.Generation.Img2Img.Resolution.Height = m.config.Generation.Txt2Img.Resolution.Height
	}

	if m.config.Generation.Img2Img.DenoiseStrength <= 0 || m.config.Generation.Img2Img.DenoiseStrength > 1 {
		m.config.Generation.Img2Img.DenoiseStrength = 0.55
	}

	if m.config.Generation.Img2Img.BatchSize <= 0 {
		m.config.Generation.Img2Img.BatchSize = 1
	}

	if m.config.Generation.History == nil {
		m.config.Generation.History = []GenerationPanelHistoryItem{}
	}

	if len(m.config.Generation.History) > 24 {
		m.config.Generation.History = m.config.Generation.History[:24]
	}

	switch m.config.Autocomplete.MatchMode {
	case "prefix", "contains", "fuzzy":
	default:
		m.config.Autocomplete.MatchMode = "prefix"
	}

	switch m.config.Autocomplete.SpacingMode {
	case "underscore", "space":
	default:
		m.config.Autocomplete.SpacingMode = "underscore"
	}

	switch m.config.Autocomplete.SortMode {
	case "popularity", "alphabetical":
	default:
		m.config.Autocomplete.SortMode = "popularity"
	}

	if m.config.Autocomplete.SuggestionCap <= 0 || m.config.Autocomplete.SuggestionCap > 50 {
		m.config.Autocomplete.SuggestionCap = 12
	}

	switch m.config.PromptFormat.CommaSpacingMode {
	case "none", "single":
	default:
		m.config.PromptFormat.CommaSpacingMode = "single"
	}
}

func normalizeCrossAttentionMethod(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "sage":
		return "sage"
	default:
		return "pytorch"
	}
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

func NormalizeSAMDetectionHint(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "center-1", "horizontal-2", "vertical-2", "rect-4", "diamond-4", "mask-area", "mask-points", "mask-point-bbox", "none":
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return "none"
	}
}

func NormalizeSAMMaskHintUseNegative(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "small":
		return "Small"
	case "outter", "outer":
		return "Outter"
	default:
		return "False"
	}
}
