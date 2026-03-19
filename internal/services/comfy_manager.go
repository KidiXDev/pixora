package services

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"pixora/internal/config"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	comfyStateIdle     = "idle"
	comfyStateStopped  = "stopped"
	comfyStateStarting = "starting"
	comfyStateRunning  = "running"
	comfyStateStopping = "stopping"
	comfyStateError    = "error"

	comfyEventStatus = "comfyui:status"
	comfyEventLog    = "comfyui:log"

	maxComfyLogEntries = 1000

	comfyStartupTimeout   = 90 * time.Second
	comfyStopGraceTimeout = 8 * time.Second
	comfyStopPollInterval = 80 * time.Millisecond
)

const comfyReadyBannerPrefix = "to see the gui go to:"

type comfyStopIntent string

const (
	comfyStopIntentNone           comfyStopIntent = ""
	comfyStopIntentUser           comfyStopIntent = "user"
	comfyStopIntentRestart        comfyStopIntent = "restart"
	comfyStopIntentStartupTimeout comfyStopIntent = "startup-timeout"
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
	State             string `json:"state"`
	Running           bool   `json:"running"`
	PID               int    `json:"pid"`
	Host              string `json:"host"`
	Port              int    `json:"port"`
	StartedAt         string `json:"startedAt"`
	LastError         string `json:"lastError"`
	StatusMessage     string `json:"statusMessage"`
	ManagedExternally bool   `json:"managedExternally"`
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
	statusMsg string

	managedExternally bool
	stopIntent        comfyStopIntent
	forceStopIssued   bool
	readinessSeen     bool
	startupFailure    string
}

func NewComfyUIManager(cfgMgr *config.Manager) (*ComfyUIManager, error) {
	manager := &ComfyUIManager{
		configMgr: cfgMgr,
		state:     comfyStateIdle,
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

	if manager.isComfyReachable(normalized.Host, normalized.Port, 1500*time.Millisecond) {
		manager.state = comfyStateRunning
		manager.managedExternally = true
		manager.startedAt = time.Now()
		manager.statusMsg = fmt.Sprintf("Connected to external ComfyUI at http://%s:%d", normalized.Host, normalized.Port)
		manager.appendLog("info", "system", "detected external ComfyUI instance and attached without launching a new process")
	} else {
		manager.state = comfyStateStopped
		manager.statusMsg = "ComfyUI is stopped"
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
		State:             m.state,
		Running:           m.state == comfyStateRunning,
		PID:               pid,
		Host:              cfg.Host,
		Port:              cfg.Port,
		StartedAt:         startedAt,
		LastError:         m.lastError,
		StatusMessage:     m.statusMsg,
		ManagedExternally: m.managedExternally,
	}
}

func (m *ComfyUIManager) Start() error {
	m.mu.Lock()
	if m.state == comfyStateRunning || m.state == comfyStateStarting {
		m.mu.Unlock()
		return nil
	}
	if m.state == comfyStateStopping {
		m.mu.Unlock()
		return fmt.Errorf("ComfyUI is stopping; wait until stop completes before starting again")
	}
	m.state = comfyStateStarting
	m.lastError = ""
	m.statusMsg = "Starting ComfyUI..."
	m.stopIntent = comfyStopIntentNone
	m.forceStopIssued = false
	m.readinessSeen = false
	m.startupFailure = ""
	m.managedExternally = false
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

	if err := m.syncBundledCustomNodes(normalized.RootDir); err != nil {
		m.failStart(fmt.Errorf("sync bundled custom nodes: %w", err))
		return err
	}

	if m.isComfyReachable(normalized.Host, normalized.Port, 1500*time.Millisecond) {
		m.mu.Lock()
		m.state = comfyStateRunning
		m.managedExternally = true
		m.startedAt = time.Now()
		m.lastError = ""
		m.statusMsg = fmt.Sprintf("Connected to existing ComfyUI at http://%s:%d", normalized.Host, normalized.Port)
		m.mu.Unlock()
		m.appendLog("info", "system", "connected to existing ComfyUI instance; launch skipped")
		m.emitStatus()
		return nil
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
	m.state = comfyStateStarting
	m.startedAt = time.Now()
	m.lastError = ""
	m.statusMsg = fmt.Sprintf("ComfyUI process started (pid=%d). Waiting for readiness...", cmd.Process.Pid)
	m.managedExternally = false
	m.stopIntent = comfyStopIntentNone
	m.forceStopIssued = false
	m.readinessSeen = false
	m.startupFailure = ""
	m.mu.Unlock()

	m.appendLog("info", "system", fmt.Sprintf("started ComfyUI pid=%d", cmd.Process.Pid))
	m.appendLog("info", "system", "waiting for ComfyUI readiness signal and API availability")
	m.emitStatus()

	go m.readProcessStream("stdout", stdout, normalized.Host, normalized.Port)
	go m.readProcessStream("stderr", stderr, normalized.Host, normalized.Port)
	go m.waitForReadiness(cmd, normalized.Host, normalized.Port, comfyStartupTimeout)
	go m.waitForExit(cmd)

	return nil
}

func (m *ComfyUIManager) Stop() error {
	return m.stopWithIntent(comfyStopIntentUser)
}

func (m *ComfyUIManager) stopWithIntent(intent comfyStopIntent) error {
	m.mu.Lock()
	if m.state == comfyStateIdle || m.state == comfyStateStopped {
		m.mu.Unlock()
		return nil
	}
	if m.state == comfyStateStopping {
		m.mu.Unlock()
		return nil
	}

	if m.managedExternally {
		m.state = comfyStateStopped
		m.startedAt = time.Time{}
		m.lastError = ""
		m.statusMsg = "Detached from external ComfyUI instance"
		m.stopIntent = comfyStopIntentNone
		m.forceStopIssued = false
		m.readinessSeen = false
		m.startupFailure = ""
		m.mu.Unlock()
		m.appendLog("info", "system", "detached from external ComfyUI instance (process not managed by Pixora)")
		m.emitStatus()
		return nil
	}

	cmd := m.cmd
	cancel := m.cancel
	m.state = comfyStateStopping
	m.statusMsg = "Stopping ComfyUI..."
	m.stopIntent = intent
	m.forceStopIssued = false
	m.mu.Unlock()
	m.emitStatus()

	if cancel != nil {
		cancel()
	}

	if cmd == nil {
		m.mu.Lock()
		m.state = comfyStateStopped
		m.startedAt = time.Time{}
		m.statusMsg = "ComfyUI stopped"
		m.stopIntent = comfyStopIntentNone
		m.mu.Unlock()
		m.emitStatus()
		return nil
	}

	deadline := time.Now().Add(comfyStopGraceTimeout)
	for {
		m.mu.RLock()
		stillRunning := m.cmd != nil
		m.mu.RUnlock()

		if !stillRunning {
			return nil
		}

		if time.Now().After(deadline) {
			m.appendLog("warn", "system", "ComfyUI did not stop gracefully in time; forcing termination")
			m.mu.Lock()
			m.forceStopIssued = true
			m.mu.Unlock()
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			return nil
		}

		time.Sleep(comfyStopPollInterval)
	}
}

func (m *ComfyUIManager) Restart() error {
	m.appendLog("info", "system", "Restart requested: stopping ComfyUI before relaunch")
	if err := m.stopWithIntent(comfyStopIntentRestart); err != nil {
		return err
	}

	m.appendLog("info", "system", "Restart continuing: launching ComfyUI")
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
	m.statusMsg = msg
	m.stopIntent = comfyStopIntentNone
	m.forceStopIssued = false
	m.readinessSeen = false
	m.startupFailure = ""
	m.mu.Unlock()

	m.appendLog("error", "system", msg)
	m.emitStatus()
}

func (m *ComfyUIManager) waitForReadiness(cmd *exec.Cmd, host string, port int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(600 * time.Millisecond)
	defer ticker.Stop()

	for {
		m.mu.RLock()
		sameProcess := m.cmd == cmd
		state := m.state
		readinessSeen := m.readinessSeen
		startupFailure := m.startupFailure
		m.mu.RUnlock()

		if !sameProcess || state != comfyStateStarting {
			return
		}

		if m.isComfyReachable(host, port, 1200*time.Millisecond) {
			m.mu.Lock()
			if m.cmd == cmd && m.state == comfyStateStarting {
				m.state = comfyStateRunning
				m.lastError = ""
				m.statusMsg = fmt.Sprintf("ComfyUI is running at http://%s:%d", host, port)
			}
			m.mu.Unlock()
			if readinessSeen {
				m.appendLog("info", "system", fmt.Sprintf("ComfyUI readiness confirmed after banner detection at http://%s:%d", host, port))
			} else {
				m.appendLog("info", "system", fmt.Sprintf("ComfyUI API became reachable at http://%s:%d", host, port))
			}
			m.emitStatus()
			return
		}

		if time.Now().After(deadline) {
			msg := strings.TrimSpace(startupFailure)
			if msg == "" {
				if readinessSeen {
					msg = "ComfyUI emitted a readiness banner but the API never became reachable. Check launch arguments and network binding."
				} else {
					msg = fmt.Sprintf("ComfyUI started but never became ready within %s. Readiness banner did not appear and API was unreachable.", timeout)
				}
			}

			m.mu.Lock()
			if m.cmd == cmd && m.state == comfyStateStarting {
				m.startupFailure = msg
				m.stopIntent = comfyStopIntentStartupTimeout
				m.statusMsg = "ComfyUI startup timed out, terminating process..."
			}
			cancel := m.cancel
			m.mu.Unlock()

			m.appendLog("error", "system", msg)
			m.emitStatus()

			if cancel != nil {
				cancel()
			}

			time.AfterFunc(2*time.Second, func() {
				m.mu.RLock()
				sameCmd := m.cmd == cmd
				stillStarting := m.state == comfyStateStarting
				m.mu.RUnlock()
				if !sameCmd || !stillStarting {
					return
				}

				m.appendLog("warn", "system", "ComfyUI startup timeout cancellation did not exit the process, forcing termination")
				if cmd.Process != nil {
					_ = cmd.Process.Kill()
				}
			})

			return
		}

		<-ticker.C
	}
}

func (m *ComfyUIManager) waitForExit(cmd *exec.Cmd) {
	err := cmd.Wait()

	m.mu.Lock()
	if m.cmd != cmd {
		m.mu.Unlock()
		return
	}

	previousState := m.state
	stopIntent := m.stopIntent
	forcedStop := m.forceStopIssued
	readinessSeen := m.readinessSeen
	startupFailure := strings.TrimSpace(m.startupFailure)

	m.cmd = nil
	m.cancel = nil
	m.startedAt = time.Time{}
	m.managedExternally = false
	m.stopIntent = comfyStopIntentNone
	m.forceStopIssued = false
	m.readinessSeen = false
	m.startupFailure = ""

	unexpectedExit := err != nil && !errors.Is(err, context.Canceled)
	userMessage := ""
	logLevel := "info"

	switch previousState {
	case comfyStateStopping:
		m.state = comfyStateStopped
		m.lastError = ""
		if forcedStop {
			logLevel = "warn"
			userMessage = "ComfyUI was force stopped after not responding to graceful shutdown"
		} else if stopIntent == comfyStopIntentRestart {
			userMessage = "ComfyUI stopped gracefully for restart"
		} else {
			userMessage = "ComfyUI stopped gracefully"
		}
		m.statusMsg = userMessage
	case comfyStateStarting:
		m.state = comfyStateError
		if startupFailure == "" {
			if unexpectedExit {
				startupFailure = explainComfyExitError(err)
			} else if !readinessSeen {
				startupFailure = "ComfyUI exited before initialization completed"
			} else {
				startupFailure = "ComfyUI exited during startup before Pixora could confirm readiness"
			}
		}
		m.lastError = startupFailure
		m.statusMsg = startupFailure
		userMessage = startupFailure
		logLevel = "error"
	case comfyStateRunning:
		if unexpectedExit {
			userMessage = explainComfyExitError(err)
		} else {
			userMessage = "ComfyUI stopped unexpectedly while it was running"
		}
		m.state = comfyStateError
		m.lastError = userMessage
		m.statusMsg = userMessage
		logLevel = "error"
	default:
		m.state = comfyStateStopped
		m.lastError = ""
		m.statusMsg = "ComfyUI stopped"
		userMessage = "ComfyUI stopped"
	}
	m.mu.Unlock()

	if err != nil {
		log.Printf("[pixora][comfyui] process exited (state=%s intent=%s forced=%t): %v", previousState, stopIntent, forcedStop, err)
	} else {
		log.Printf("[pixora][comfyui] process exited cleanly (state=%s intent=%s forced=%t)", previousState, stopIntent, forcedStop)
	}
	m.appendLog(logLevel, "system", userMessage)

	m.emitStatus()
}

func (m *ComfyUIManager) readProcessStream(stream string, r io.Reader, host string, port int) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		log.Printf("[pixora][comfyui][%s] %s", stream, line)

		level := detectStreamLogLevel(stream, line)
		normalizedLine := strings.ToLower(line)

		if strings.Contains(normalizedLine, comfyReadyBannerPrefix) {
			m.mu.Lock()
			if m.state == comfyStateStarting {
				m.readinessSeen = true
				m.statusMsg = "ComfyUI reported readiness banner, validating API..."
			}
			m.mu.Unlock()
			m.appendLog("info", "system", fmt.Sprintf("readiness banner detected: %s", line))
			m.emitStatus()
		}

		if looksLikePortInUse(normalizedLine) {
			msg := fmt.Sprintf("Port %d is already in use. Stop the existing service or choose a different ComfyUI port.", port)
			m.mu.Lock()
			if m.state == comfyStateStarting {
				m.startupFailure = msg
			}
			m.mu.Unlock()
			m.appendLog("warn", "system", msg)
		}

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

func (m *ComfyUIManager) isComfyReachable(host string, port int, timeout time.Duration) bool {
	if strings.TrimSpace(host) == "" || port <= 0 {
		return false
	}

	url := fmt.Sprintf("http://%s:%d/system_stats", host, port)
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode >= 200 && resp.StatusCode < 500
}

func explainComfyExitError(err error) string {
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	if msg == "" {
		return "ComfyUI exited unexpectedly"
	}

	if strings.Contains(msg, "access violation") || strings.Contains(msg, "0xc0000005") {
		return "ComfyUI crashed due to a native access violation. This is usually caused by GPU driver/CUDA runtime instability."
	}

	if strings.Contains(msg, "out of memory") || strings.Contains(msg, "cuda out of memory") {
		return "ComfyUI ran out of GPU memory. Lower resolution, steps, or VRAM usage and try again."
	}

	if strings.Contains(msg, "status 3221225786") {
		return "ComfyUI hit a Windows native crash. This is often caused by GPU driver/runtime mismatch."
	}

	if looksLikePortInUse(msg) {
		return "ComfyUI could not start because the configured port is already in use."
	}

	return "ComfyUI exited unexpectedly. Check ComfyUI logs for details."
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

func (m *ComfyUIManager) syncBundledCustomNodes(rootDir string) error {
	sourceDir := filepath.Join(rootDir, "backend", "node", "pixorabridge")
	destDir := filepath.Join(rootDir, "backend", "comfy", "ComfyUI", "custom_nodes", "pixorabridge")

	if _, err := os.Stat(sourceDir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			m.appendLog("warn", "system", fmt.Sprintf("bundled custom node source not found: %s", sourceDir))
			return nil
		}
		return fmt.Errorf("stat source custom node directory: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(destDir), 0755); err != nil {
		return fmt.Errorf("create custom_nodes directory: %w", err)
	}

	if runtime.GOOS == "windows" && isDevRuntime(rootDir) {
		if err := ensureJunctionLink(sourceDir, destDir); err != nil {
			return fmt.Errorf("create pixorabridge junction: %w", err)
		}
		m.appendLog("info", "system", fmt.Sprintf("synced bundled custom node using junction: %s -> %s", sourceDir, destDir))
		return nil
	}

	if err := os.RemoveAll(destDir); err != nil {
		return fmt.Errorf("remove existing custom node target: %w", err)
	}

	if err := copyDirectoryRecursive(sourceDir, destDir); err != nil {
		return fmt.Errorf("copy pixorabridge custom node: %w", err)
	}

	m.appendLog("info", "system", fmt.Sprintf("synced bundled custom node: %s -> %s", sourceDir, destDir))
	return nil
}

func isDevRuntime(rootDir string) bool {
	if strings.TrimSpace(rootDir) == "" {
		return false
	}

	if _, err := os.Stat(filepath.Join(rootDir, "go.mod")); err == nil {
		return true
	}

	return false
}

func ensureJunctionLink(sourceDir string, targetDir string) error {
	sourceAbs, err := filepath.Abs(sourceDir)
	if err != nil {
		return fmt.Errorf("resolve source path: %w", err)
	}
	targetAbs, err := filepath.Abs(targetDir)
	if err != nil {
		return fmt.Errorf("resolve target path: %w", err)
	}

	if info, statErr := os.Lstat(targetAbs); statErr == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			resolved, resolveErr := filepath.EvalSymlinks(targetAbs)
			if resolveErr == nil {
				resolvedAbs, absErr := filepath.Abs(resolved)
				if absErr == nil && samePath(resolvedAbs, sourceAbs) {
					return nil
				}
			}

			// A junction already exists at target; keep it and skip per dev-mode behavior.
			return nil
		}

		if err := os.RemoveAll(targetAbs); err != nil {
			return fmt.Errorf("remove existing non-junction target: %w", err)
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return fmt.Errorf("stat target path: %w", statErr)
	}

	cmd := exec.Command("cmd", "/c", "mklink", "/J", targetAbs, sourceAbs)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("mklink /J failed: %w, output: %s", err, strings.TrimSpace(string(output)))
	}

	return nil
}

func samePath(left string, right string) bool {
	leftClean := filepath.Clean(strings.TrimSpace(left))
	rightClean := filepath.Clean(strings.TrimSpace(right))

	if runtime.GOOS == "windows" {
		return strings.EqualFold(leftClean, rightClean)
	}

	return leftClean == rightClean
}

func copyDirectoryRecursive(sourceDir string, targetDir string) error {
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("create target directory %s: %w", targetDir, err)
	}

	entries, err := os.ReadDir(sourceDir)
	if err != nil {
		return fmt.Errorf("read source directory %s: %w", sourceDir, err)
	}

	for _, entry := range entries {
		name := entry.Name()
		if shouldSkipCustomNodeEntry(name, entry.IsDir()) {
			continue
		}

		sourcePath := filepath.Join(sourceDir, name)
		targetPath := filepath.Join(targetDir, name)

		if entry.IsDir() {
			if err := copyDirectoryRecursive(sourcePath, targetPath); err != nil {
				return err
			}
			continue
		}

		if err := copyFile(sourcePath, targetPath); err != nil {
			return err
		}
	}

	return nil
}

func shouldSkipCustomNodeEntry(name string, isDir bool) bool {
	normalized := strings.ToLower(strings.TrimSpace(name))
	if normalized == "" {
		return true
	}

	if isDir {
		switch normalized {
		case ".git", ".github", ".venv", "venv", ".pytest_cache", ".mypy_cache", ".ruff_cache", "__pycache__", ".idea", ".vscode":
			return true
		}
	}

	if strings.HasSuffix(normalized, ".pyc") || strings.HasSuffix(normalized, ".pyo") {
		return true
	}

	return false
}

func copyFile(sourcePath string, targetPath string) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open source file %s: %w", sourcePath, err)
	}
	defer source.Close()

	info, err := source.Stat()
	if err != nil {
		return fmt.Errorf("stat source file %s: %w", sourcePath, err)
	}

	target, err := os.Create(targetPath)
	if err != nil {
		return fmt.Errorf("create target file %s: %w", targetPath, err)
	}

	if _, err := io.Copy(target, source); err != nil {
		_ = target.Close()
		return fmt.Errorf("copy file %s to %s: %w", sourcePath, targetPath, err)
	}

	if err := target.Close(); err != nil {
		return fmt.Errorf("close target file %s: %w", targetPath, err)
	}

	if err := os.Chmod(targetPath, info.Mode()); err != nil {
		return fmt.Errorf("set mode for target file %s: %w", targetPath, err)
	}

	return nil
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

func looksLikePortInUse(message string) bool {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if normalized == "" {
		return false
	}

	return strings.Contains(normalized, "address already in use") ||
		strings.Contains(normalized, "only one usage of each socket address") ||
		strings.Contains(normalized, "errno 98") ||
		strings.Contains(normalized, "eaddrinuse")
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
