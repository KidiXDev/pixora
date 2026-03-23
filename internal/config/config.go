package config

import (
	"encoding/json"
	"os"
	"path/filepath"
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
	RootDir        string `json:"rootDir"`
	PythonPath     string `json:"pythonPath"`
	MainScriptPath string `json:"mainScriptPath"`
	Args           string `json:"args"`
	OutputDir      string `json:"outputDir"`
	ModelPathsYAML string `json:"modelPathsYAML"`
	Host           string `json:"host"`
	Port           int    `json:"port"`
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

type GenerationPanelTxt2Img struct {
	Prompt         string                    `json:"prompt"`
	NegativePrompt string                    `json:"negativePrompt"`
	Seed           string                    `json:"seed"`
	Steps          int                       `json:"steps"`
	CFGScale       float64                   `json:"cfgScale"`
	Resolution     GenerationPanelResolution `json:"resolution"`
	Model          string                    `json:"model"`
	VAE            string                    `json:"vae"`
	Sampler        string                    `json:"sampler"`
	Scheduler      string                    `json:"scheduler"`
	BatchSize      int                       `json:"batchSize"`
	Refine         GenerationPanelRefine     `json:"refine"`
}

type GenerationPanelImg2Img struct {
	Prompt          string                    `json:"prompt"`
	NegativePrompt  string                    `json:"negativePrompt"`
	Seed            string                    `json:"seed"`
	Steps           int                       `json:"steps"`
	CFGScale        float64                   `json:"cfgScale"`
	Resolution      GenerationPanelResolution `json:"resolution"`
	Model           string                    `json:"model"`
	VAE             string                    `json:"vae"`
	Sampler         string                    `json:"sampler"`
	Scheduler       string                    `json:"scheduler"`
	SourceImagePath string                    `json:"sourceImagePath"`
	BatchSize       int                       `json:"batchSize"`
	DenoiseStrength float64                   `json:"denoiseStrength"`
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
	ActiveBackend string                       `json:"activeBackend"`
	Mode          string                       `json:"mode"`
	Txt2Img       GenerationPanelTxt2Img       `json:"txt2img"`
	Img2Img       GenerationPanelImg2Img       `json:"img2img"`
	History       []GenerationPanelHistoryItem `json:"history"`
	GenerateForever bool                       `json:"generateForever"`
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

	if m.config.Generation.Txt2Img.Resolution.Width <= 0 {
		m.config.Generation.Txt2Img.Resolution.Width = 1024
	}

	if m.config.Generation.Txt2Img.Resolution.Height <= 0 {
		m.config.Generation.Txt2Img.Resolution.Height = 1024
	}

	if m.config.Generation.Txt2Img.BatchSize <= 0 {
		m.config.Generation.Txt2Img.BatchSize = 1
	}

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
