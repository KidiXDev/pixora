package services

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"pixora/internal/config"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	generationEventStatus  = "generation:status"
	generationEventResult  = "generation:result"
	generationEventPreview = "generation:preview"

	generationQueueStateQueued    = "queued"
	generationQueueStateRunning   = "running"
	generationQueueStateCompleted = "completed"
	generationQueueStateCanceled  = "canceled"
	generationQueueStateError     = "error"
)

const (
	defaultGenerationSteps     = 28
	defaultGenerationCFGScale  = 7.0
	defaultGenerationWidth     = 1024
	defaultGenerationHeight    = 1024
	defaultGenerationSampler   = "euler_ancestral"
	defaultGenerationScheduler = "normal"
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
	Schedulers      []string `json:"schedulers"`
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
	mu     sync.Mutex
	cache  map[string]completionDataset

	queueMu       sync.Mutex
	queue         []*GenerationQueueJob
	jobs          map[string]*GenerationQueueJob
	queueWakeupCh chan struct{}
}

type GenerationQueueJob struct {
	JobID      string `json:"jobId"`
	Mode       string `json:"mode"`
	Prompt     string `json:"prompt"`
	State      string `json:"state"`
	QueuedAt   string `json:"queuedAt"`
	StartedAt  string `json:"startedAt"`
	FinishedAt string `json:"finishedAt"`
	Error      string `json:"error"`
	PromptID   string `json:"promptId"`

	req      GenerationRequest
	cancel   context.CancelFunc
	canceled bool

	comfyPromptID string
}

type QueueGenerationResponse struct {
	JobID    string `json:"jobId"`
	Position int    `json:"position"`
	State    string `json:"state"`
}

type GenerationRequest struct {
	RequestID      string  `json:"requestId"`
	Mode           string  `json:"mode"`
	Prompt         string  `json:"prompt"`
	NegativePrompt string  `json:"negativePrompt"`
	Seed           string  `json:"seed"`
	Steps          int     `json:"steps"`
	CFGScale       float64 `json:"cfgScale"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	Model          string  `json:"model"`
	VAE            string  `json:"vae"`
	Sampler        string  `json:"sampler"`
	Scheduler      string  `json:"scheduler"`
}

type GenerationStatus struct {
	PromptID    string  `json:"promptId"`
	State       string  `json:"state"`
	Progress    float64 `json:"progress"`
	Message     string  `json:"message"`
	PreviewPath string  `json:"previewPath"`
	Error       string  `json:"error"`
	StartedAt   string  `json:"startedAt"`
}

type GenerationResult struct {
	PromptID    string `json:"promptId"`
	Mode        string `json:"mode"`
	ImagePath   string `json:"imagePath"`
	OutputDir   string `json:"outputDir"`
	Seed        string `json:"seed"`
	StartedAt   string `json:"startedAt"`
	CompletedAt string `json:"completedAt"`
}

type WorkflowPreview struct {
	Mode         string                       `json:"mode"`
	Prompt       map[string]comfyWorkflowNode `json:"prompt"`
	OutputDir    string                       `json:"outputDir"`
	ResolvedSeed string                       `json:"resolvedSeed"`
}

type comfyWorkflowNode struct {
	Inputs    map[string]any `json:"inputs"`
	ClassType string         `json:"class_type"`
	Meta      map[string]any `json:"_meta,omitempty"`
}

type comfyPromptRequest struct {
	Prompt   map[string]comfyWorkflowNode `json:"prompt"`
	ClientID string                       `json:"client_id,omitempty"`
}

type comfyPromptResponse struct {
	PromptID string `json:"prompt_id"`
}

type comfyHistoryNodeOutput struct {
	Images []struct {
		Filename  string `json:"filename"`
		Subfolder string `json:"subfolder"`
		Type      string `json:"type"`
	} `json:"images"`
}

type comfyHistoryEntry struct {
	Outputs map[string]comfyHistoryNodeOutput `json:"outputs"`
}

type comfyWSMessage struct {
	Type string         `json:"type"`
	Data map[string]any `json:"data"`
}

func NewGenerationService(cfg *config.Manager) *GenerationService {
	service := &GenerationService{
		config:        cfg,
		cache:         make(map[string]completionDataset),
		queue:         make([]*GenerationQueueJob, 0),
		jobs:          make(map[string]*GenerationQueueJob),
		queueWakeupCh: make(chan struct{}, 1),
	}

	go service.processQueue()

	return service
}

func (s *GenerationService) GetGenerationPanelConfig() (config.GenerationPanelConfig, error) {
	if s.config == nil {
		return config.GenerationPanelConfig{}, fmt.Errorf("missing config manager")
	}

	return s.config.GetGenerationPanelConfig(), nil
}

func (s *GenerationService) SetGenerationPanelConfig(cfg config.GenerationPanelConfig) error {
	if s.config == nil {
		return fmt.Errorf("missing config manager")
	}

	return s.config.SetGenerationPanelConfig(cfg)
}

func (s *GenerationService) GenerateText2Image(req GenerationRequest) (*GenerationResult, error) {
	return s.generateText2ImageInternal(context.Background(), req, "", nil)
}

func (s *GenerationService) GetModelCatalog() (*GenerationModelCatalog, error) {
	if s.config == nil {
		return nil, fmt.Errorf("missing config manager")
	}

	comfyCfg := s.config.GetComfyUIConfig()
	modelsRoot, err := resolveGenerationModelsRoot(comfyCfg)
	if err != nil {
		return nil, err
	}

	catalog := &GenerationModelCatalog{
		Samplers:        defaultSamplers(),
		Schedulers:      defaultSchedulers(),
		Checkpoints:     listCheckpointModelFiles(modelsRoot),
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

func resolveGenerationModelsRoot(cfg config.ComfyUIBackendConfig) (string, error) {
	runtimeRoot, err := resolveRuntimeRoot(cfg.RootDir)
	if err != nil {
		return "", fmt.Errorf("resolve runtime root: %w", err)
	}

	candidates := []string{
		filepath.Join(runtimeRoot, "data", "sd"),
	}

	if cwd, cwdErr := os.Getwd(); cwdErr == nil {
		candidates = append(candidates, filepath.Join(cwd, "data", "sd"))
	}

	bestPath := ""
	bestScore := -1
	for _, candidate := range uniqueAndSorted(candidates) {
		info, statErr := os.Stat(candidate)
		if statErr != nil {
			continue
		}
		if !info.IsDir() {
			continue
		}

		score := scoreModelsRoot(candidate)
		if score > bestScore {
			bestScore = score
			bestPath = candidate
		}
	}

	if bestPath != "" {
		return bestPath, nil
	}

	return "", fmt.Errorf("stat models root: %w", os.ErrNotExist)
}

func scoreModelsRoot(root string) int {
	total := 0
	total += len(listCheckpointModelFiles(root))
	total += len(listModelFiles(filepath.Join(root, "vae"), checkpointLikeExtensions))
	total += len(listModelFiles(filepath.Join(root, "loras"), checkpointLikeExtensions))
	total += len(listModelFiles(filepath.Join(root, "controlnet"), checkpointLikeExtensions))
	total += len(listModelFiles(filepath.Join(root, "upscale_models"), upscaleModelExtensions))
	total += len(listModelFiles(filepath.Join(root, "text_encoders"), textEncoderExtensions))
	total += len(listModelFiles(filepath.Join(root, "clip"), textEncoderExtensions))
	total += len(listModelFiles(filepath.Join(root, "diffusion_models"), checkpointLikeExtensions))
	total += len(listModelFiles(filepath.Join(root, "unet"), checkpointLikeExtensions))
	return total
}

func listCheckpointModelFiles(modelsRoot string) []string {
	return listModelFiles(filepath.Join(modelsRoot, "checkpoints"), checkpointLikeExtensions)
}

func (s *GenerationService) GetAutocompleteSources() ([]string, error) {
	if s.config == nil {
		return nil, fmt.Errorf("missing config manager")
	}

	comfyCfg := s.config.GetComfyUIConfig()
	completionRoot, err := resolveGenerationCompletionRoot(comfyCfg)
	if err != nil {
		return nil, err
	}

	return listCompletionCSVFiles(completionRoot), nil
}

func (s *GenerationService) GetAutocompleteSuggestions(query AutocompleteQuery) ([]AutocompleteSuggestion, error) {
	if s.config == nil {
		return nil, fmt.Errorf("missing config manager")
	}

	cfg := s.config.GetConfig().Autocomplete
	if !cfg.Enabled {
		return []AutocompleteSuggestion{}, nil
	}

	requested := strings.TrimSpace(query.Input)
	if requested == "" {
		return []AutocompleteSuggestion{}, nil
	}

	comfyCfg := s.config.GetComfyUIConfig()
	completionRoot, err := resolveGenerationCompletionRoot(comfyCfg)
	if err != nil {
		return nil, err
	}

	sourcePath, err := s.resolveAutocompleteSource(completionRoot, cfg.Source)
	if err != nil {
		return nil, err
	}

	entries, err := s.loadCompletionEntries(sourcePath)
	if err != nil {
		return nil, err
	}

	normalizedNeedle := normalizeAutocompleteToken(requested, cfg.Whitespace)
	if normalizedNeedle == "" {
		return []AutocompleteSuggestion{}, nil
	}

	limit := cfg.SuggestionCap
	if limit <= 0 {
		limit = 12
	}
	if query.Limit > 0 {
		limit = query.Limit
	}
	if limit > 50 {
		limit = 50
	}

	candidates := make([]autocompleteCandidate, 0, limit)
	for _, entry := range entries {
		rank, matchedBy, matchedValue, ok := matchAutocompleteEntry(entry, normalizedNeedle, cfg.MatchMode, cfg.Whitespace)
		if !ok {
			continue
		}

		candidates = append(candidates, autocompleteCandidate{
			entry:        entry,
			rank:         rank,
			matchedBy:    matchedBy,
			matchedValue: matchedValue,
		})
	}

	sortAutocompleteCandidates(candidates, cfg.SortMode)
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}

	suggestions := make([]AutocompleteSuggestion, 0, len(candidates))
	for _, candidate := range candidates {
		suggestions = append(suggestions, AutocompleteSuggestion{
			Tag:          candidate.entry.Tag,
			Category:     candidate.entry.Category,
			Popularity:   candidate.entry.Popularity,
			Alternative:  strings.Join(candidate.entry.Alternatives, ","),
			InsertText:   formatInsertTag(candidate.entry.Tag, cfg),
			MatchedBy:    candidate.matchedBy,
			MatchedValue: candidate.matchedValue,
		})
	}

	return suggestions, nil
}

func defaultSchedulers() []string {
	return []string{
		"simple",
		"sgm_uniform",
		"karras",
		"exponential",
		"ddim_uniform",
		"beta",
		"normal",
		"linear_quadratic",
		"kl_optimal",
	}
}

func defaultSamplers() []string {
	return []string{
		"euler",
		"euler_cfg_pp",
		"euler_ancestral",
		"euler_ancestral_cfg_pp",
		"heun",
		"heunpp2",
		"exp_heun_2_x0",
		"exp_heun_2_x0_sde",
		"dpm_2",
		"dpm_2_ancestral",
		"lms",
		"dpm_fast",
		"dpm_adaptive",
		"dpmpp_2s_ancestral",
		"dpmpp_2s_ancestral_cfg_pp",
		"dpmpp_sde",
		"dpmpp_sde_gpu",
		"dpmpp_2m",
		"dpmpp_2m_cfg_pp",
		"dpmpp_2m_sde",
		"dpmpp_2m_sde_gpu",
		"dpmpp_2m_sde_heun",
		"dpmpp_2m_sde_heun_gpu",
		"dpmpp_3m_sde",
		"dpmpp_3m_sde_gpu",
		"ddpm",
		"lcm",
		"ipndm",
		"ipndm_v",
		"deis",
		"res_multistep",
		"res_multistep_cfg_pp",
		"res_multistep_ancestral",
		"res_multistep_ancestral_cfg_pp",
		"gradient_estimation",
		"gradient_estimation_cfg_pp",
		"er_sde",
		"seeds_2",
		"seeds_3",
		"sa_solver",
		"sa_solver_pece",
		"ddim",
		"uni_pc",
		"uni_pc_bh2",
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

func (s *GenerationService) resolveAutocompleteSource(completionRoot string, sourceName string) (string, error) {
	sources := listCompletionCSVFiles(completionRoot)

	if len(sources) == 0 {
		return "", fmt.Errorf("no CSV completion source found in %s", completionRoot)
	}

	chosen := strings.TrimSpace(sourceName)
	if chosen == "" {
		chosen = sources[0]
	}

	if filepath.Base(chosen) != chosen {
		return "", fmt.Errorf("invalid autocomplete source %q", sourceName)
	}

	if !strings.EqualFold(filepath.Ext(chosen), ".csv") {
		return "", fmt.Errorf("autocomplete source must be a .csv file")
	}

	path := filepath.Join(completionRoot, chosen)
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("autocomplete source not found: %s", chosen)
		}
		return "", fmt.Errorf("read autocomplete source: %w", err)
	}

	return path, nil
}

func resolveGenerationCompletionRoot(cfg config.ComfyUIBackendConfig) (string, error) {
	runtimeRoot, err := resolveRuntimeRoot(cfg.RootDir)
	if err != nil {
		return "", fmt.Errorf("resolve runtime root: %w", err)
	}

	candidates := []string{
		filepath.Join(runtimeRoot, "data", "completion"),
	}

	if cwd, cwdErr := os.Getwd(); cwdErr == nil {
		candidates = append(candidates, filepath.Join(cwd, "data", "completion"))
	}

	bestPath := ""
	bestScore := -1
	for _, candidate := range uniqueAndSorted(candidates) {
		info, statErr := os.Stat(candidate)
		if statErr != nil || !info.IsDir() {
			continue
		}

		score := countCompletionCSVFiles(candidate)
		if score > bestScore {
			bestScore = score
			bestPath = candidate
		}
	}

	if bestPath != "" {
		return bestPath, nil
	}

	return "", fmt.Errorf("read completion directory: %w", os.ErrNotExist)
}

func listCompletionCSVFiles(completionRoot string) []string {
	entries, err := os.ReadDir(completionRoot)
	if err != nil {
		return []string{}
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := strings.TrimSpace(entry.Name())
		if name == "" || strings.HasPrefix(name, ".") {
			continue
		}

		if strings.EqualFold(filepath.Ext(name), ".csv") {
			files = append(files, name)
		}
	}

	return uniqueAndSorted(files)
}

func countCompletionCSVFiles(completionRoot string) int {
	return len(listCompletionCSVFiles(completionRoot))
}

func (s *GenerationService) loadCompletionEntries(sourcePath string) ([]completionEntry, error) {
	info, err := os.Stat(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("stat autocomplete source: %w", err)
	}

	s.mu.Lock()
	cached, hasCached := s.cache[sourcePath]
	if hasCached && cached.modTime.Equal(info.ModTime()) && cached.size == info.Size() {
		entries := cached.entries
		s.mu.Unlock()
		return entries, nil
	}
	s.mu.Unlock()

	file, err := os.Open(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("open autocomplete source: %w", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	entries := make([]completionEntry, 0, 4096)
	for {
		record, readErr := reader.Read()
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return nil, fmt.Errorf("parse autocomplete source: %w", readErr)
		}

		entry, ok := parseCompletionRecord(record)
		if !ok {
			continue
		}

		entries = append(entries, entry)
	}

	s.mu.Lock()
	s.cache[sourcePath] = completionDataset{
		path:    sourcePath,
		modTime: info.ModTime(),
		size:    info.Size(),
		entries: entries,
	}
	s.mu.Unlock()

	return entries, nil
}

func parseCompletionRecord(record []string) (completionEntry, bool) {
	if len(record) == 0 {
		return completionEntry{}, false
	}

	tag := strings.TrimSpace(record[0])
	if tag == "" {
		return completionEntry{}, false
	}

	category := 0
	if len(record) >= 2 {
		parsedCategory, err := strconv.Atoi(strings.TrimSpace(record[1]))
		if err == nil {
			category = parsedCategory
		}
	}

	popularity := 0
	if len(record) >= 3 {
		parsedPopularity, err := strconv.Atoi(strings.TrimSpace(record[2]))
		if err == nil {
			popularity = parsedPopularity
		}
	}

	alternatives := make([]string, 0)
	if len(record) >= 4 {
		for _, candidate := range strings.Split(record[3], ",") {
			normalized := strings.TrimSpace(candidate)
			if normalized == "" {
				continue
			}
			alternatives = append(alternatives, normalized)
		}
	}

	return completionEntry{
		Tag:          tag,
		Category:     category,
		Popularity:   popularity,
		Alternatives: uniqueAndSorted(alternatives),
	}, true
}

func matchAutocompleteEntry(entry completionEntry, needle string, matchMode string, whitespace bool) (int, string, string, bool) {
	tag := normalizeAutocompleteToken(entry.Tag, whitespace)
	rank, ok := autocompleteMatchRank(tag, needle, matchMode)
	if ok {
		return rank, "tag", entry.Tag, true
	}

	bestRank := 0
	bestValue := ""
	hasAltMatch := false
	for _, alt := range entry.Alternatives {
		normalized := normalizeAutocompleteToken(alt, whitespace)
		altRank, altOK := autocompleteMatchRank(normalized, needle, matchMode)
		if !altOK {
			continue
		}

		adjustedRank := altRank + 4
		if !hasAltMatch || adjustedRank < bestRank {
			hasAltMatch = true
			bestRank = adjustedRank
			bestValue = alt
		}
	}

	if hasAltMatch {
		return bestRank, "alternative", bestValue, true
	}

	return 0, "", "", false
}

func autocompleteMatchRank(haystack string, needle string, mode string) (int, bool) {
	if haystack == "" || needle == "" {
		return 0, false
	}

	switch mode {
	case "contains":
		if strings.HasPrefix(haystack, needle) {
			return 0, true
		}
		if strings.Contains(haystack, needle) {
			return 1, true
		}
		return 0, false
	case "fuzzy":
		if strings.HasPrefix(haystack, needle) {
			return 0, true
		}
		if strings.Contains(haystack, needle) {
			return 1, true
		}
		if fuzzyContains(haystack, needle) {
			return 2, true
		}
		return 0, false
	default:
		if strings.HasPrefix(haystack, needle) {
			return 0, true
		}
		return 0, false
	}
}

func fuzzyContains(haystack string, needle string) bool {
	hIndex := 0
	nRunes := []rune(needle)
	hRunes := []rune(haystack)
	for _, nr := range nRunes {
		found := false
		for hIndex < len(hRunes) {
			if hRunes[hIndex] == nr {
				found = true
				hIndex++
				break
			}
			hIndex++
		}
		if !found {
			return false
		}
	}
	return true
}

func normalizeAutocompleteToken(value string, whitespace bool) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return ""
	}

	if whitespace {
		parts := strings.Fields(normalized)
		if len(parts) > 0 {
			normalized = strings.Join(parts, "_")
		}
	}

	return normalized
}

func sortAutocompleteCandidates(candidates []autocompleteCandidate, sortMode string) {
	sort.Slice(candidates, func(i int, j int) bool {
		left := candidates[i]
		right := candidates[j]

		if left.rank != right.rank {
			return left.rank < right.rank
		}

		switch sortMode {
		case "alphabetical":
			leftTag := strings.ToLower(left.entry.Tag)
			rightTag := strings.ToLower(right.entry.Tag)
			if leftTag != rightTag {
				return leftTag < rightTag
			}
			return left.entry.Popularity > right.entry.Popularity
		default:
			if left.entry.Popularity != right.entry.Popularity {
				return left.entry.Popularity > right.entry.Popularity
			}

			leftTag := strings.ToLower(left.entry.Tag)
			rightTag := strings.ToLower(right.entry.Tag)
			return leftTag < rightTag
		}
	})
}

func formatInsertTag(tag string, cfg config.AutocompleteConfig) string {
	formatted := strings.TrimSpace(tag)
	if cfg.SpacingMode == "space" {
		formatted = strings.ReplaceAll(formatted, "_", " ")
	}

	if cfg.EscapeParens {
		formatted = strings.ReplaceAll(formatted, "(", `\(`)
		formatted = strings.ReplaceAll(formatted, ")", `\)`)
	}

	if strings.TrimSpace(cfg.Suffix) != "" {
		formatted += cfg.Suffix
	}

	return formatted
}

func (s *GenerationService) emitGenerationStatus(status GenerationStatus) {
	app := application.Get()
	if app == nil || app.Event == nil {
		return
	}
	app.Event.Emit(generationEventStatus, status)
}

func (s *GenerationService) emitGenerationResult(result GenerationResult) {
	app := application.Get()
	if app == nil || app.Event == nil {
		return
	}
	app.Event.Emit(generationEventResult, result)
}

func (s *GenerationService) emitGenerationPreview(promptID string, imagePath string) {
	app := application.Get()
	if app == nil || app.Event == nil {
		return
	}
	app.Event.Emit(generationEventPreview, map[string]string{
		"promptId":  promptID,
		"imagePath": imagePath,
	})
}
