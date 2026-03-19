package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"pixora/internal/config"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
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

func (s *GenerationService) QueueText2Image(req GenerationRequest) (*QueueGenerationResponse, error) {
	if s.config == nil {
		return nil, fmt.Errorf("missing config manager")
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "txt2img"
	}
	if mode != "txt2img" {
		return nil, fmt.Errorf("only txt2img queue is supported for now")
	}

	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, fmt.Errorf("prompt is required")
	}

	jobID := strings.TrimSpace(req.RequestID)
	if jobID == "" {
		jobID = fmt.Sprintf("job-%d", time.Now().UnixNano())
	}

	job := &GenerationQueueJob{
		JobID:    jobID,
		Mode:     mode,
		Prompt:   prompt,
		State:    generationQueueStateQueued,
		QueuedAt: time.Now().Format(time.RFC3339),
		req:      req,
	}

	s.queueMu.Lock()
	if _, exists := s.jobs[job.JobID]; exists {
		s.queueMu.Unlock()
		return nil, fmt.Errorf("generation request id already exists")
	}
	s.jobs[job.JobID] = job
	s.queue = append(s.queue, job)
	position := len(s.queue)
	s.queueMu.Unlock()

	s.emitGenerationStatus(GenerationStatus{
		PromptID:  job.JobID,
		State:     generationQueueStateQueued,
		Progress:  0,
		Message:   "queued generation job",
		StartedAt: job.QueuedAt,
	})

	s.notifyQueueWorker()

	return &QueueGenerationResponse{
		JobID:    job.JobID,
		Position: position,
		State:    job.State,
	}, nil
}

func (s *GenerationService) ListGenerationQueue() []GenerationQueueJob {
	s.queueMu.Lock()
	defer s.queueMu.Unlock()

	items := make([]GenerationQueueJob, 0, len(s.jobs))
	for _, job := range s.jobs {
		items = append(items, GenerationQueueJob{
			JobID:      job.JobID,
			Mode:       job.Mode,
			Prompt:     job.Prompt,
			State:      job.State,
			QueuedAt:   job.QueuedAt,
			StartedAt:  job.StartedAt,
			FinishedAt: job.FinishedAt,
			Error:      job.Error,
			PromptID:   job.PromptID,
		})
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].QueuedAt > items[j].QueuedAt
	})

	return items
}

func (s *GenerationService) CancelGenerationJob(jobID string) error {
	trimmed := strings.TrimSpace(jobID)
	if trimmed == "" {
		return fmt.Errorf("job id is required")
	}

	s.queueMu.Lock()
	job, exists := s.jobs[trimmed]
	if !exists {
		s.queueMu.Unlock()
		return fmt.Errorf("generation job not found")
	}

	job.canceled = true
	if job.cancel != nil {
		job.cancel()
	}

	if job.State == generationQueueStateQueued || job.State == generationQueueStateRunning {
		job.State = generationQueueStateCanceled
		job.Error = "canceled"
		job.FinishedAt = time.Now().Format(time.RFC3339)
	}
	s.queueMu.Unlock()

	s.emitGenerationStatus(GenerationStatus{
		PromptID:  trimmed,
		State:     generationQueueStateCanceled,
		Progress:  0,
		Message:   "generation canceled",
		Error:     "canceled",
		StartedAt: job.StartedAt,
	})

	return nil
}

func (s *GenerationService) notifyQueueWorker() {
	select {
	case s.queueWakeupCh <- struct{}{}:
	default:
	}
}

func (s *GenerationService) processQueue() {
	for {
		job := s.dequeueNextRunnableJob()
		if job == nil {
			<-s.queueWakeupCh
			continue
		}

		ctx, cancel := context.WithCancel(context.Background())
		s.queueMu.Lock()
		if job.canceled {
			job.State = generationQueueStateCanceled
			job.Error = "canceled"
			job.FinishedAt = time.Now().Format(time.RFC3339)
			s.queueMu.Unlock()
			continue
		}
		job.cancel = cancel
		job.State = generationQueueStateRunning
		job.StartedAt = time.Now().Format(time.RFC3339)
		s.queueMu.Unlock()

		result, err := s.generateText2ImageInternal(ctx, job.req, job.JobID)
		cancel()

		s.queueMu.Lock()
		job.cancel = nil
		job.FinishedAt = time.Now().Format(time.RFC3339)
		if job.canceled {
			job.State = generationQueueStateCanceled
			job.Error = "canceled"
		} else if err != nil {
			job.State = generationQueueStateError
			job.Error = err.Error()
		} else {
			job.State = generationQueueStateCompleted
			job.PromptID = result.PromptID
		}
		s.queueMu.Unlock()
	}
}

func (s *GenerationService) dequeueNextRunnableJob() *GenerationQueueJob {
	s.queueMu.Lock()
	defer s.queueMu.Unlock()

	for len(s.queue) > 0 {
		job := s.queue[0]
		s.queue = s.queue[1:]
		if job == nil {
			continue
		}
		if job.State != generationQueueStateQueued {
			continue
		}
		return job
	}

	return nil
}

func (s *GenerationService) GenerateText2Image(req GenerationRequest) (*GenerationResult, error) {
	return s.generateText2ImageInternal(context.Background(), req, "")
}

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

func (s *GenerationService) generateText2ImageInternal(ctx context.Context, req GenerationRequest, overridePromptID string) (*GenerationResult, error) {
	if s.config == nil {
		return nil, fmt.Errorf("missing config manager")
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "txt2img"
	}
	if mode != "txt2img" {
		return nil, fmt.Errorf("only txt2img generation is supported for now")
	}

	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, fmt.Errorf("prompt is required")
	}

	preview, err := s.buildText2ImageWorkflowPreview(req)
	if err != nil {
		return nil, err
	}
	workflow := preview.Prompt
	outputDir := preview.OutputDir
	resolvedSeed := preview.ResolvedSeed

	cfg := s.config.GetComfyUIConfig()
	baseURL := buildComfyBaseURL(cfg)
	clientID := fmt.Sprintf("pixora-%d", time.Now().UnixNano())
	promptID, err := postComfyPrompt(baseURL, workflow, clientID)
	if err != nil {
		return nil, err
	}

	emitPromptID := strings.TrimSpace(req.RequestID)
	if emitPromptID == "" {
		emitPromptID = promptID
	}
	if strings.TrimSpace(overridePromptID) != "" {
		emitPromptID = strings.TrimSpace(overridePromptID)
	}

	startTime := time.Now()
	startedAt := startTime.Format(time.RFC3339)
	s.emitGenerationStatus(GenerationStatus{
		PromptID:  emitPromptID,
		State:     "queued",
		Progress:  0,
		Message:   "queued txt2img workflow",
		StartedAt: startedAt,
	})

	knownFiles := snapshotImageFiles(outputDir)
	resultPath, err := monitorGeneration(ctx, baseURL, promptID, clientID, outputDir, knownFiles, func(previewPath string) {
		s.emitGenerationStatus(GenerationStatus{
			PromptID:    emitPromptID,
			State:       "running",
			Progress:    0.5,
			Message:     "generation running",
			PreviewPath: previewPath,
			StartedAt:   startedAt,
		})
		s.emitGenerationPreview(emitPromptID, previewPath)
	}, func(progress float64, message string) {
		s.emitGenerationStatus(GenerationStatus{
			PromptID:  emitPromptID,
			State:     "running",
			Progress:  progress,
			Message:   message,
			StartedAt: startedAt,
		})
	})
	if err != nil {
		state := generationQueueStateError
		errText := err.Error()
		if errors.Is(err, context.Canceled) {
			state = generationQueueStateCanceled
			errText = "canceled"
		}

		s.emitGenerationStatus(GenerationStatus{
			PromptID:  emitPromptID,
			State:     state,
			Progress:  0,
			Message:   "generation failed",
			Error:     errText,
			StartedAt: startedAt,
		})
		return nil, err
	}

	result := &GenerationResult{
		PromptID:    emitPromptID,
		Mode:        mode,
		ImagePath:   resultPath,
		OutputDir:   outputDir,
		Seed:        resolvedSeed,
		StartedAt:   startedAt,
		CompletedAt: time.Now().Format(time.RFC3339),
	}

	s.emitGenerationStatus(GenerationStatus{
		PromptID:    emitPromptID,
		State:       "completed",
		Progress:    1,
		Message:     "generation completed",
		PreviewPath: resultPath,
		StartedAt:   startedAt,
	})
	s.emitGenerationResult(*result)

	return result, nil
}

func (s *GenerationService) buildText2ImageWorkflowPreview(req GenerationRequest) (*WorkflowPreview, error) {
	if s.config == nil {
		return nil, fmt.Errorf("missing config manager")
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "txt2img"
	}
	if mode != "txt2img" {
		return nil, fmt.Errorf("only txt2img workflow preview is supported for now")
	}

	cfg := s.config.GetComfyUIConfig()
	runtimeRoot, err := resolveRuntimeRoot(cfg.RootDir)
	if err != nil {
		return nil, fmt.Errorf("resolve runtime root: %w", err)
	}

	workflowPath := filepath.Join(runtimeRoot, "backend", "workflow", "PixoraTxt2Img.json")
	workflow, err := loadWorkflowTemplate(workflowPath)
	if err != nil {
		return nil, err
	}

	outputDir, err := resolveGenerationOutputDirPath(cfg, mode)
	if err != nil {
		return nil, err
	}

	resolvedSeed := resolveGenerationSeed(req.Seed)
	if err := injectTxt2ImgWorkflow(workflow, req, resolvedSeed, outputDir); err != nil {
		return nil, err
	}

	return &WorkflowPreview{
		Mode:         mode,
		Prompt:       workflow,
		OutputDir:    outputDir,
		ResolvedSeed: resolvedSeed,
	}, nil
}

type AutocompleteQuery struct {
	Input string `json:"input"`
	Limit int    `json:"limit"`
}

type AutocompleteSuggestion struct {
	Tag          string `json:"tag"`
	Category     int    `json:"category"`
	Popularity   int    `json:"popularity"`
	Alternative  string `json:"alternative"`
	InsertText   string `json:"insertText"`
	MatchedBy    string `json:"matchedBy"`
	MatchedValue string `json:"matchedValue"`
}

type completionDataset struct {
	path    string
	modTime time.Time
	size    int64
	entries []completionEntry
}

type completionEntry struct {
	Tag          string
	Category     int
	Popularity   int
	Alternatives []string
}

type autocompleteCandidate struct {
	entry        completionEntry
	rank         int
	matchedBy    string
	matchedValue string
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
		Schedulers:      defaultSchedulers(),
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

func (s *GenerationService) GetAutocompleteSources() ([]string, error) {
	if s.config == nil {
		return nil, fmt.Errorf("missing config manager")
	}

	comfyCfg := s.config.GetComfyUIConfig()
	runtimeRoot, err := resolveRuntimeRoot(comfyCfg.RootDir)
	if err != nil {
		return nil, fmt.Errorf("resolve runtime root: %w", err)
	}

	completionRoot := filepath.Join(runtimeRoot, "data", "completion")
	entries, err := os.ReadDir(completionRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, fmt.Errorf("read completion directory: %w", err)
	}

	files := make([]string, 0)
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

	return uniqueAndSorted(files), nil
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
	runtimeRoot, err := resolveRuntimeRoot(comfyCfg.RootDir)
	if err != nil {
		return nil, fmt.Errorf("resolve runtime root: %w", err)
	}

	sourcePath, err := s.resolveAutocompleteSource(runtimeRoot, cfg.Source)
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

func (s *GenerationService) resolveAutocompleteSource(runtimeRoot string, sourceName string) (string, error) {
	completionRoot := filepath.Join(runtimeRoot, "data", "completion")

	sources, err := s.GetAutocompleteSources()
	if err != nil {
		return "", err
	}

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

func buildComfyBaseURL(cfg config.ComfyUIBackendConfig) string {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		host = "127.0.0.1"
	}
	port := cfg.Port
	if port <= 0 || port > 65535 {
		port = 7180
	}
	return fmt.Sprintf("http://%s:%d", host, port)
}

func postComfyPrompt(baseURL string, graph map[string]comfyWorkflowNode, clientID string) (string, error) {
	payload, err := json.Marshal(comfyPromptRequest{Prompt: graph, ClientID: clientID})
	if err != nil {
		return "", fmt.Errorf("serialize comfy prompt: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/prompt", baseURL), bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create comfy prompt request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request comfy prompt: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return "", fmt.Errorf("comfy prompt failed: status=%d body=%s", resp.StatusCode, string(body))
	}

	var parsed comfyPromptResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", fmt.Errorf("decode comfy prompt response: %w", err)
	}

	if strings.TrimSpace(parsed.PromptID) == "" {
		return "", fmt.Errorf("comfy prompt response missing prompt_id")
	}

	return strings.TrimSpace(parsed.PromptID), nil
}

func monitorGeneration(
	ctx context.Context,
	baseURL string,
	promptID string,
	clientID string,
	outputDir string,
	knownFiles map[string]time.Time,
	onPreview func(string),
	onProgress func(float64, string),
) (string, error) {
	deadline := time.Now().Add(6 * time.Minute)
	ticker := time.NewTicker(700 * time.Millisecond)
	defer ticker.Stop()

	wsDone := make(chan struct{})
	defer close(wsDone)
	go streamComfyPreview(ctx, baseURL, clientID, promptID, outputDir, onPreview, onProgress, wsDone)

	lastPreview := ""
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}

		if time.Now().After(deadline) {
			return "", fmt.Errorf("generation timed out")
		}

		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-ticker.C:
			previewPath := findNewestImage(outputDir, knownFiles)
			if previewPath != "" && previewPath != lastPreview {
				lastPreview = previewPath
				onPreview(previewPath)
			}

			historyEntry, done, err := getHistoryEntry(baseURL, promptID)
			if err != nil {
				continue
			}
			if !done {
				continue
			}

			resultPath := extractImagePathFromHistory(historyEntry, outputDir)
			if resultPath == "" {
				resultPath = findNewestImage(outputDir, map[string]time.Time{})
			}

			if resultPath == "" {
				return "", fmt.Errorf("generation completed but no output image found")
			}

			return resultPath, nil
		}
	}
}

func getHistoryEntry(baseURL string, promptID string) (comfyHistoryEntry, bool, error) {
	url := fmt.Sprintf("%s/history/%s", baseURL, promptID)
	resp, err := http.Get(url)
	if err != nil {
		return comfyHistoryEntry{}, false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return comfyHistoryEntry{}, false, fmt.Errorf("history status=%d", resp.StatusCode)
	}

	var payload map[string]comfyHistoryEntry
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return comfyHistoryEntry{}, false, err
	}

	entry, ok := payload[promptID]
	if !ok {
		return comfyHistoryEntry{}, false, nil
	}

	return entry, true, nil
}

func extractImagePathFromHistory(entry comfyHistoryEntry, outputDir string) string {
	for _, output := range entry.Outputs {
		for _, image := range output.Images {
			fileName := strings.TrimSpace(image.Filename)
			if fileName == "" {
				continue
			}

			sub := strings.TrimSpace(image.Subfolder)
			if sub != "" {
				return filepath.Join(outputDir, sub, fileName)
			}

			return filepath.Join(outputDir, fileName)
		}
	}

	return ""
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

func snapshotImageFiles(root string) map[string]time.Time {
	snapshot := make(map[string]time.Time)
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if strings.EqualFold(strings.TrimSpace(d.Name()), ".preview") {
				return filepath.SkipDir
			}
			return nil
		}
		if !isImageFile(path) {
			return nil
		}
		info, statErr := d.Info()
		if statErr != nil {
			return nil
		}
		snapshot[path] = info.ModTime()
		return nil
	})
	return snapshot
}

func findNewestImage(root string, known map[string]time.Time) string {
	newestPath := ""
	newestTime := time.Time{}

	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if strings.EqualFold(strings.TrimSpace(d.Name()), ".preview") {
				return filepath.SkipDir
			}
			return nil
		}
		if !isImageFile(path) {
			return nil
		}

		info, statErr := d.Info()
		if statErr != nil {
			return nil
		}

		if oldTime, exists := known[path]; exists && !info.ModTime().After(oldTime) {
			return nil
		}

		if newestTime.IsZero() || info.ModTime().After(newestTime) {
			newestTime = info.ModTime()
			newestPath = path
		}
		return nil
	})

	return newestPath
}

func isImageFile(path string) bool {
	ext := strings.ToLower(strings.TrimSpace(filepath.Ext(path)))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".bmp":
		return true
	default:
		return false
	}
}

func streamComfyPreview(
	ctx context.Context,
	baseURL string,
	clientID string,
	promptID string,
	outputDir string,
	onPreview func(string),
	onProgress func(float64, string),
	stop <-chan struct{},
) {
	wsURL, err := buildComfyWebSocketURL(baseURL, clientID)
	if err != nil {
		debugGenerationWS("build ws url failed: prompt=%s err=%v", promptID, err)
		return
	}

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		debugGenerationWS("ws dial failed: prompt=%s url=%s err=%v", promptID, wsURL, err)
		return
	}
	defer conn.Close()
	debugGenerationWS("ws connected: prompt=%s url=%s", promptID, wsURL)

	go func() {
		select {
		case <-ctx.Done():
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
			_ = conn.Close()
		case <-stop:
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
			_ = conn.Close()
		}
	}()

	activePrompt := false
	for {
		if err := ctx.Err(); err != nil {
			return
		}

		messageType, payload, readErr := conn.ReadMessage()
		if readErr != nil {
			debugGenerationWS("ws read ended: prompt=%s err=%v", promptID, readErr)
			return
		}

		switch messageType {
		case websocket.TextMessage:
			var msg comfyWSMessage
			if err := json.Unmarshal(payload, &msg); err != nil {
				debugGenerationWS("ws text unmarshal failed: prompt=%s bytes=%d err=%v", promptID, len(payload), err)
				continue
			}
			debugGenerationWS("ws text: prompt=%s type=%s", promptID, msg.Type)

			switch msg.Type {
			case "execution_start":
				if getMapString(msg.Data, "prompt_id") == promptID {
					activePrompt = true
					onProgress(0.5, "execution started")
				}
			case "executing":
				if getMapString(msg.Data, "prompt_id") == promptID {
					activePrompt = true
					onProgress(0.55, "executing workflow")
					if isExecutionFinished(msg.Data) {
						activePrompt = false
					}
				} else {
					activePrompt = false
				}
			case "execution_error":
				if getMapString(msg.Data, "prompt_id") == promptID {
					activePrompt = false
				}
			case "executed":
				if getMapString(msg.Data, "prompt_id") != promptID {
					continue
				}

				imagePath := extractImagePathFromWSData(msg.Data, outputDir)
				if imagePath != "" {
					onPreview(imagePath)
					onProgress(0.98, "saving output")
				}
			case "progress":
				if getMapString(msg.Data, "prompt_id") != promptID {
					continue
				}

				value := getMapFloat(msg.Data, "value")
				max := getMapFloat(msg.Data, "max")
				if max <= 0 {
					continue
				}

				progress := 0.55 + ((value / max) * 0.4)
				onProgress(clampFloat(progress, 0.55, 0.95), fmt.Sprintf("step %.0f/%.0f", value, max))
			}
		case websocket.BinaryMessage:
			if !activePrompt {
				debugGenerationWS("ws binary ignored (inactive prompt): prompt=%s bytes=%d", promptID, len(payload))
				continue
			}

			imageBytes, ext, ok := extractPreviewImagePayload(payload)
			if !ok {
				debugGenerationWS("ws binary not preview image: prompt=%s bytes=%d", promptID, len(payload))
				continue
			}

			previewDataURL := encodePreviewDataURL(imageBytes, ext)
			if previewDataURL == "" {
				debugGenerationWS("preview data url encode failed: prompt=%s ext=%s", promptID, ext)
				continue
			}

			onPreview(previewDataURL)
		}
	}
}

func encodePreviewDataURL(imageBytes []byte, ext string) string {
	if len(imageBytes) == 0 {
		return ""
	}

	mimeType := previewMimeTypeByExt(ext)
	if mimeType == "" {
		mimeType = "image/png"
	}

	encoded := base64.StdEncoding.EncodeToString(imageBytes)
	if strings.TrimSpace(encoded) == "" {
		return ""
	}

	return "data:" + mimeType + ";base64," + encoded
}

func previewMimeTypeByExt(ext string) string {
	switch strings.ToLower(strings.TrimSpace(ext)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	default:
		return ""
	}
}

func debugGenerationWS(format string, args ...any) {
	if !isGenerationWSDebugEnabled() {
		return
	}
	log.Printf("[pixora][generation][ws] "+format, args...)
}

func isGenerationWSDebugEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("PIXORA_DEBUG_GENERATION_WS")))
	switch value {
	case "1", "true", "yes", "on", "debug":
		return true
	default:
		return false
	}
}

func buildComfyWebSocketURL(baseURL string, clientID string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}

	scheme := "ws"
	if strings.EqualFold(parsed.Scheme, "https") {
		scheme = "wss"
	}

	query := url.Values{}
	query.Set("clientId", clientID)

	parsed.Scheme = scheme
	parsed.Path = "/ws"
	parsed.RawQuery = query.Encode()

	return parsed.String(), nil
}

func extractPreviewImagePayload(payload []byte) ([]byte, string, bool) {
	if len(payload) < 4 {
		return nil, "", false
	}

	if ext, ok := detectImageExtension(payload); ok {
		return payload, ext, true
	}

	if len(payload) > 8 {
		trimmed := payload[8:]
		if ext, ok := detectImageExtension(trimmed); ok {
			return trimmed, ext, true
		}
	}

	return nil, "", false
}

func detectImageExtension(payload []byte) (string, bool) {
	if len(payload) >= 8 && bytes.Equal(payload[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
		return ".png", true
	}

	if len(payload) >= 2 && payload[0] == 0xFF && payload[1] == 0xD8 {
		return ".jpg", true
	}

	if len(payload) >= 12 && string(payload[:4]) == "RIFF" && string(payload[8:12]) == "WEBP" {
		return ".webp", true
	}

	return "", false
}

func getMapString(input map[string]any, key string) string {
	raw, ok := input[key]
	if !ok {
		return ""
	}
	value, ok := raw.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func getMapFloat(input map[string]any, key string) float64 {
	raw, ok := input[key]
	if !ok {
		return 0
	}

	switch value := raw.(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case json.Number:
		parsed, _ := value.Float64()
		return parsed
	default:
		return 0
	}
}

func isExecutionFinished(input map[string]any) bool {
	raw, ok := input["node"]
	if !ok || raw == nil {
		return true
	}

	if text, ok := raw.(string); ok {
		return strings.TrimSpace(text) == ""
	}

	return false
}

func extractImagePathFromWSData(data map[string]any, outputDir string) string {
	output, ok := data["output"].(map[string]any)
	if !ok {
		return ""
	}

	images, ok := output["images"].([]any)
	if !ok {
		return ""
	}

	for _, raw := range images {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		if providedPath := strings.TrimSpace(getMapString(item, "path")); providedPath != "" {
			if filepath.IsAbs(providedPath) {
				return providedPath
			}
			return filepath.Join(outputDir, providedPath)
		}

		fileName := strings.TrimSpace(getMapString(item, "filename"))
		if fileName == "" {
			continue
		}

		subfolder := strings.TrimSpace(getMapString(item, "subfolder"))
		if subfolder == "" {
			return filepath.Join(outputDir, fileName)
		}

		return filepath.Join(outputDir, subfolder, fileName)
	}

	return ""
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
