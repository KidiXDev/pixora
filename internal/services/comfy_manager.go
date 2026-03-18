package services

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"pixora/internal/config"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	comfyStateStopped  = "stopped"
	comfyStateStarting = "starting"
	comfyStateRunning  = "running"
	comfyStateStopping = "stopping"
	comfyStateError    = "error"

	comfyEventStatus = "comfyui:status"
	comfyEventLog    = "comfyui:log"

	maxComfyLogEntries = 1000
)

var comfyModelSubdirs = []string{
	"checkpoints",
	"text_encoders",
	"clip",
	"controlnet",
	"diffusion_models",
	"unet",
	"embeddings",
	"loras",
	"upscale_models",
	"vae",
}

type ComfyUIStatus struct {
	State     string `json:"state"`
	Running   bool   `json:"running"`
	PID       int    `json:"pid"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	StartedAt string `json:"startedAt"`
	LastError string `json:"lastError"`
}

type ComfyUILogEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Stream    string `json:"stream"`
	Message   string `json:"message"`
}

type ComfyUIManager struct {
	configMgr *config.Manager

	mu        sync.RWMutex
	state     string
	logs      []ComfyUILogEntry
	cmd       *exec.Cmd
	cancel    context.CancelFunc
	startedAt time.Time
	lastError string
}

func NewComfyUIManager(cfgMgr *config.Manager) (*ComfyUIManager, error) {
	manager := &ComfyUIManager{
		configMgr: cfgMgr,
		state:     comfyStateStopped,
		logs:      []ComfyUILogEntry{},
	}

	cfg := cfgMgr.GetComfyUIConfig()
	normalized, err := manager.prepareRuntimeConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("prepare comfy runtime config: %w", err)
	}

	if err := cfgMgr.SetComfyUIConfig(normalized); err != nil {
		return nil, fmt.Errorf("persist comfy runtime config: %w", err)
	}

	return manager, nil
}

func (m *ComfyUIManager) GetComfyUIConfig() config.ComfyUIBackendConfig {
	return m.configMgr.GetComfyUIConfig()
}

func (m *ComfyUIManager) SetComfyUIConfig(next config.ComfyUIBackendConfig) (config.ComfyUIBackendConfig, error) {
	normalized, err := m.prepareRuntimeConfig(next)
	if err != nil {
		return config.ComfyUIBackendConfig{}, err
	}

	if err := m.configMgr.SetComfyUIConfig(normalized); err != nil {
		return config.ComfyUIBackendConfig{}, err
	}

	m.appendLog("info", "system", "updated ComfyUI configuration")
	return normalized, nil
}

func (m *ComfyUIManager) GetStatus() ComfyUIStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	cfg := m.configMgr.GetComfyUIConfig()
	pid := 0
	if m.cmd != nil && m.cmd.Process != nil {
		pid = m.cmd.Process.Pid
	}

	startedAt := ""
	if !m.startedAt.IsZero() {
		startedAt = m.startedAt.Format(time.RFC3339)
	}

	return ComfyUIStatus{
		State:     m.state,
		Running:   m.state == comfyStateRunning,
		PID:       pid,
		Host:      cfg.Host,
		Port:      cfg.Port,
		StartedAt: startedAt,
		LastError: m.lastError,
	}
}

func (m *ComfyUIManager) Start() error {
	m.mu.Lock()
	if m.state == comfyStateRunning || m.state == comfyStateStarting {
		m.mu.Unlock()
		return nil
	}
	m.state = comfyStateStarting
	m.lastError = ""
	m.mu.Unlock()
	m.emitStatus()

	cfg := m.configMgr.GetComfyUIConfig()
	normalized, err := m.prepareRuntimeConfig(cfg)
	if err != nil {
		m.failStart(fmt.Errorf("prepare runtime config: %w", err))
		return err
	}

	if err := m.configMgr.SetComfyUIConfig(normalized); err != nil {
		m.failStart(fmt.Errorf("persist runtime config: %w", err))
		return err
	}

	args := m.buildLaunchArgs(normalized)
	cmdArgs := append([]string{normalized.MainScriptPath}, args...)

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, normalized.PythonPath, cmdArgs...)
	cmd.Dir = filepath.Dir(normalized.MainScriptPath)

	log.Printf("[pixora][comfyui] launch cwd=%s", cmd.Dir)
	log.Printf("[pixora][comfyui] launch command=%s", formatCommandForLog(normalized.PythonPath, cmdArgs))

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		m.failStart(fmt.Errorf("create stdout pipe: %w", err))
		return err
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		m.failStart(fmt.Errorf("create stderr pipe: %w", err))
		return err
	}

	if err := cmd.Start(); err != nil {
		cancel()
		m.failStart(fmt.Errorf("start comfy process: %w", err))
		return err
	}

	m.mu.Lock()
	m.cmd = cmd
	m.cancel = cancel
	m.state = comfyStateRunning
	m.startedAt = time.Now()
	m.lastError = ""
	m.mu.Unlock()

	m.appendLog("info", "system", fmt.Sprintf("started ComfyUI pid=%d", cmd.Process.Pid))
	m.emitStatus()

	go m.readProcessStream("stdout", stdout)
	go m.readProcessStream("stderr", stderr)
	go m.waitForExit(cmd)

	return nil
}

func (m *ComfyUIManager) Stop() error {
	m.mu.Lock()
	if m.state == comfyStateStopped {
		m.mu.Unlock()
		return nil
	}
	if m.state == comfyStateStopping {
		m.mu.Unlock()
		return nil
	}

	cmd := m.cmd
	cancel := m.cancel
	m.state = comfyStateStopping
	m.mu.Unlock()
	m.emitStatus()

	if cancel != nil {
		cancel()
	}

	if cmd == nil {
		m.mu.Lock()
		m.state = comfyStateStopped
		m.startedAt = time.Time{}
		m.mu.Unlock()
		m.emitStatus()
		return nil
	}

	deadline := time.Now().Add(8 * time.Second)
	for {
		m.mu.RLock()
		stillRunning := m.cmd != nil
		m.mu.RUnlock()

		if !stillRunning {
			return nil
		}

		if time.Now().After(deadline) {
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			return nil
		}

		time.Sleep(80 * time.Millisecond)
	}
}

func (m *ComfyUIManager) Restart() error {
	if err := m.Stop(); err != nil {
		return err
	}

	return m.Start()
}

func (m *ComfyUIManager) ListLogs(limit int) []ComfyUILogEntry {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if limit <= 0 {
		limit = 300
	}

	start := 0
	if len(m.logs) > limit {
		start = len(m.logs) - limit
	}

	out := make([]ComfyUILogEntry, len(m.logs[start:]))
	copy(out, m.logs[start:])
	return out
}

func (m *ComfyUIManager) ClearLogs() {
	m.mu.Lock()
	m.logs = []ComfyUILogEntry{}
	m.mu.Unlock()
}

func (m *ComfyUIManager) failStart(err error) {
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		msg = "unknown error"
	}
	log.Printf("[pixora][comfyui] start failed: %s", msg)

	m.mu.Lock()
	m.cmd = nil
	m.cancel = nil
	m.state = comfyStateError
	m.startedAt = time.Time{}
	m.lastError = msg
	m.mu.Unlock()

	m.appendLog("error", "system", msg)
	m.emitStatus()
}

func (m *ComfyUIManager) waitForExit(cmd *exec.Cmd) {
	err := cmd.Wait()

	m.mu.Lock()
	if m.cmd != cmd {
		m.mu.Unlock()
		return
	}

	wasStopping := m.state == comfyStateStopping
	m.cmd = nil
	m.cancel = nil
	m.startedAt = time.Time{}

	if err != nil && !errors.Is(err, context.Canceled) {
		m.state = comfyStateError
		m.lastError = err.Error()
	} else {
		m.state = comfyStateStopped
		if wasStopping {
			m.lastError = ""
		}
	}
	m.mu.Unlock()

	if err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("[pixora][comfyui] process exit error: %v", err)
		m.appendLog("error", "system", fmt.Sprintf("ComfyUI exited with error: %v", err))
	} else {
		log.Printf("[pixora][comfyui] process stopped")
		m.appendLog("info", "system", "ComfyUI stopped")
	}

	m.emitStatus()
}

func (m *ComfyUIManager) readProcessStream(stream string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		log.Printf("[pixora][comfyui][%s] %s", stream, line)

		level := detectStreamLogLevel(stream, line)

		m.appendLog(level, stream, line)
	}

	if err := scanner.Err(); err != nil {
		log.Printf("[pixora][comfyui][%s] stream read error: %v", stream, err)
		m.appendLog("warn", stream, fmt.Sprintf("stream read error: %v", err))
	}
}

func (m *ComfyUIManager) appendLog(level string, stream string, message string) {
	entry := ComfyUILogEntry{
		Timestamp: time.Now().Format(time.RFC3339),
		Level:     strings.TrimSpace(strings.ToLower(level)),
		Stream:    strings.TrimSpace(strings.ToLower(stream)),
		Message:   strings.TrimSpace(message),
	}

	if entry.Message == "" {
		return
	}

	m.mu.Lock()
	m.logs = append(m.logs, entry)
	if len(m.logs) > maxComfyLogEntries {
		m.logs = m.logs[len(m.logs)-maxComfyLogEntries:]
	}
	m.mu.Unlock()

	m.emitLog(entry)
}

func (m *ComfyUIManager) emitStatus() {
	if app := application.Get(); app != nil && app.Event != nil {
		app.Event.Emit(comfyEventStatus, m.GetStatus())
	}
}

func (m *ComfyUIManager) emitLog(entry ComfyUILogEntry) {
	if app := application.Get(); app != nil && app.Event != nil {
		app.Event.Emit(comfyEventLog, entry)
	}
}

func (m *ComfyUIManager) buildLaunchArgs(cfg config.ComfyUIBackendConfig) []string {
	args := strings.Fields(cfg.Args)

	args = ensureArgPair(args, "--listen", cfg.Host)
	args = ensureArgPair(args, "--port", strconv.Itoa(cfg.Port))
	args = ensureFlag(args, "--normalvram")
	args = ensureArgPair(args, "--preview-method", "auto")
	args = ensureFlag(args, "--use-pytorch-cross-attention")
	args = ensureFlag(args, "--enable-manager")
	args = ensureArgPair(args, "--extra-model-paths-config", cfg.ModelPathsYAML)

	return args
}

func (m *ComfyUIManager) prepareRuntimeConfig(cfg config.ComfyUIBackendConfig) (config.ComfyUIBackendConfig, error) {
	rootDir, err := resolveRuntimeRoot(cfg.RootDir)
	if err != nil {
		return config.ComfyUIBackendConfig{}, err
	}

	cfg.RootDir = rootDir

	if cfg.Host == "" {
		cfg.Host = "127.0.0.1"
	}
	if cfg.Port <= 0 {
		cfg.Port = 7180
	}
	if strings.TrimSpace(cfg.Args) == "" {
		cfg.Args = "--listen 127.0.0.1 --port 7180 --normalvram --preview-method auto --use-pytorch-cross-attention --enable-manager"
	}

	cfg.PythonPath = resolveRuntimePath(rootDir, cfg.PythonPath, filepath.Join("backend", "comfy", "python_embeded", "python.exe"))
	cfg.MainScriptPath = resolveRuntimePath(rootDir, cfg.MainScriptPath, filepath.Join("backend", "comfy", "ComfyUI", "main.py"))
	cfg.OutputDir = resolveRuntimePath(rootDir, cfg.OutputDir, filepath.Join("data", "output"))
	cfg.ModelPathsYAML = resolveRuntimePath(rootDir, cfg.ModelPathsYAML, filepath.Join("backend", "comfy", "ComfyUI", "extra_model_paths.pixora.yaml"))

	if _, err := os.Stat(cfg.PythonPath); err != nil {
		return config.ComfyUIBackendConfig{}, fmt.Errorf("python executable not found: %s", cfg.PythonPath)
	}

	if _, err := os.Stat(cfg.MainScriptPath); err != nil {
		return config.ComfyUIBackendConfig{}, fmt.Errorf("ComfyUI main.py not found: %s", cfg.MainScriptPath)
	}

	if err := os.MkdirAll(cfg.OutputDir, 0755); err != nil {
		return config.ComfyUIBackendConfig{}, fmt.Errorf("create output dir: %w", err)
	}

	modelsRoot := filepath.Join(rootDir, "data", "sd")
	for _, dir := range comfyModelSubdirs {
		if err := os.MkdirAll(filepath.Join(modelsRoot, dir), 0755); err != nil {
			return config.ComfyUIBackendConfig{}, fmt.Errorf("create model dir %s: %w", dir, err)
		}
	}

	if err := os.MkdirAll(filepath.Dir(cfg.ModelPathsYAML), 0755); err != nil {
		return config.ComfyUIBackendConfig{}, fmt.Errorf("create model paths yaml dir: %w", err)
	}

	if err := writeModelPathsYAML(cfg.ModelPathsYAML, modelsRoot); err != nil {
		return config.ComfyUIBackendConfig{}, fmt.Errorf("write model paths yaml: %w", err)
	}

	return cfg, nil
}

func resolveRuntimeRoot(configured string) (string, error) {
	configured = strings.TrimSpace(configured)
	if configured != "" {
		root := configured
		if !filepath.IsAbs(root) {
			cwd, err := os.Getwd()
			if err != nil {
				return "", fmt.Errorf("get working directory: %w", err)
			}
			root = filepath.Join(cwd, configured)
		}
		root = filepath.Clean(root)
		if hasComfyRuntime(root) {
			return root, nil
		}
	}

	candidates := make([]string, 0, 6)
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates, exeDir, filepath.Dir(exeDir))
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, cwd, filepath.Dir(cwd))
	}

	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		candidate = filepath.Clean(candidate)
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}

		if hasComfyRuntime(candidate) {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("unable to resolve runtime root containing backend/comfy/ComfyUI/main.py")
}

func hasComfyRuntime(root string) bool {
	if root == "" {
		return false
	}

	pythonPath := filepath.Join(root, "backend", "comfy", "python_embeded", "python.exe")
	mainPath := filepath.Join(root, "backend", "comfy", "ComfyUI", "main.py")

	if _, err := os.Stat(pythonPath); err != nil {
		return false
	}
	if _, err := os.Stat(mainPath); err != nil {
		return false
	}

	return true
}

func resolveRuntimePath(root string, value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return filepath.Clean(filepath.Join(root, fallback))
	}

	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed)
	}

	return filepath.Clean(filepath.Join(root, trimmed))
}

func writeModelPathsYAML(filePath string, modelsRoot string) error {
	root := strings.ReplaceAll(filepath.ToSlash(modelsRoot), "\\", "/")

	content := strings.Join([]string{
		"comfyui:",
		fmt.Sprintf("  base_path: \"%s\"", root),
		"  checkpoints: checkpoints",
		"  text_encoders: |",
		"    text_encoders",
		"    clip",
		"  clip_vision: clip_vision",
		"  configs: configs",
		"  controlnet: controlnet",
		"  diffusion_models: |",
		"    diffusion_models",
		"    unet",
		"  embeddings: embeddings",
		"  loras: loras",
		"  upscale_models: upscale_models",
		"  vae: vae",
	}, "\n") + "\n"

	return os.WriteFile(filePath, []byte(content), 0644)
}

func ensureFlag(args []string, flag string) []string {
	if hasFlag(args, flag) {
		return args
	}

	return append(args, flag)
}

func ensureArgPair(args []string, flag string, value string) []string {
	if hasFlag(args, flag) {
		return args
	}

	if strings.TrimSpace(value) == "" {
		return args
	}

	return append(args, flag, value)
}

func hasFlag(args []string, flag string) bool {
	for _, arg := range args {
		if arg == flag {
			return true
		}
		if strings.HasPrefix(arg, flag+"=") {
			return true
		}
	}

	return false
}

func detectStreamLogLevel(stream string, line string) string {
	normalizedLine := strings.ToLower(strings.TrimSpace(line))

	if strings.Contains(normalizedLine, "traceback") ||
		strings.Contains(normalizedLine, "exception") ||
		strings.Contains(normalizedLine, "fatal") ||
		strings.Contains(normalizedLine, "panic") ||
		strings.Contains(normalizedLine, "error:") ||
		strings.HasPrefix(normalizedLine, "error") {
		return "error"
	}

	if strings.Contains(normalizedLine, "warning") ||
		strings.HasPrefix(normalizedLine, "warn") {
		return "warn"
	}

	if stream == "stderr" {
		return "warn"
	}

	return "info"
}

func formatCommandForLog(executable string, args []string) string {
	parts := make([]string, 0, len(args)+1)
	parts = append(parts, strconv.Quote(executable))
	for _, arg := range args {
		parts = append(parts, strconv.Quote(arg))
	}

	return strings.Join(parts, " ")
}
