package services

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	comfySetupStateChecking   = "checking"
	comfySetupStateMissing    = "missing"
	comfySetupStateReady      = "ready"
	comfySetupStateInstalling = "installing"
	comfySetupStateError      = "error"
)

const (
	comfySetupStepPending   = "pending"
	comfySetupStepRunning   = "running"
	comfySetupStepCompleted = "completed"
	comfySetupStepError     = "error"
)

const (
	comfySetupErrorPermissionProblem      = "permission_problem"
	comfySetupErrorWorkspaceInitFailure   = "workspace_init_failure"
	comfySetupErrorDownloadFailure        = "download_failure"
	comfySetupErrorExtractionFailure      = "extraction_failure"
	comfySetupErrorInvalidArchive         = "invalid_archive_structure"
	comfySetupErrorUnsupportedGPUExpected = "unsupported_gpu_expectation"
	comfySetupErrorIncompleteInstall      = "incomplete_installation"
)

const (
	comfyInstallArchiveURL      = "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.17.2/ComfyUI_windows_portable_nvidia_cu126.7z"
	comfyInstallArchiveName     = "ComfyUI_windows_portable_nvidia_cu126.7z"
	comfyInstallExtractedFolder = "ComfyUI_windows_portable"
)

type ComfyUISetupStep struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

type ComfyUISetupStatus struct {
	State              string             `json:"state"`
	WorkspaceRoot      string             `json:"workspaceRoot"`
	InstallDir         string             `json:"installDir"`
	StatusMessage      string             `json:"statusMessage"`
	CurrentStepID      string             `json:"currentStepId"`
	CurrentStepMessage string             `json:"currentStepMessage"`
	EventSeq           uint64             `json:"eventSeq"`
	DownloadProgress   float64            `json:"downloadProgress"`
	DownloadedBytes    int64              `json:"downloadedBytes"`
	TotalBytes         int64              `json:"totalBytes"`
	DownloadSpeed      float64            `json:"downloadSpeed"`
	LastError          string             `json:"lastError"`
	ErrorKind          string             `json:"errorKind"`
	PermissionProblem  bool               `json:"permissionProblem"`
	PermissionMessage  string             `json:"permissionMessage"`
	IsInstalled        bool               `json:"isInstalled"`
	IsReady            bool               `json:"isReady"`
	RequiresOnboarding bool               `json:"requiresOnboarding"`
	NvidiaOnly         bool               `json:"nvidiaOnly"`
	Steps              []ComfyUISetupStep `json:"steps"`
}

type comfySetupError struct {
	kind        string
	userMessage string
	err         error
}

func (e *comfySetupError) Error() string {
	msg := strings.TrimSpace(e.userMessage)
	switch {
	case msg != "" && e.err != nil:
		return fmt.Sprintf("%s: %v", msg, e.err)
	case msg != "":
		return msg
	case e.err != nil:
		return e.err.Error()
	default:
		return "unknown comfy setup error"
	}
}

func (e *comfySetupError) Unwrap() error {
	return e.err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func defaultComfySetupSteps() []ComfyUISetupStep {
	return []ComfyUISetupStep{
		{ID: "check_environment", Label: "Check Environment", Status: comfySetupStepPending},
		{ID: "detect_comfy", Label: "Detect ComfyUI", Status: comfySetupStepPending},
		{ID: "download_archive", Label: "Download Archive", Status: comfySetupStepPending},
		{ID: "extract_archive", Label: "Extract Archive", Status: comfySetupStepPending},
		{ID: "finalize_install_dir", Label: "Finalize Installation Folder", Status: comfySetupStepPending},
		{ID: "prepare_model_paths", Label: "Prepare Model Paths", Status: comfySetupStepPending},
		{ID: "copy_custom_nodes", Label: "Copy Custom Nodes", Status: comfySetupStepPending},
		{ID: "complete", Label: "Installation Complete", Status: comfySetupStepPending},
	}
}

func defaultComfySetupStatus() ComfyUISetupStatus {
	return ComfyUISetupStatus{
		State:              comfySetupStateChecking,
		StatusMessage:      "Checking ComfyUI environment",
		RequiresOnboarding: true,
		NvidiaOnly:         true,
		Steps:              defaultComfySetupSteps(),
	}
}

func newComfySetupError(kind string, userMessage string, err error) error {
	return &comfySetupError{
		kind:        strings.TrimSpace(kind),
		userMessage: strings.TrimSpace(userMessage),
		err:         err,
	}
}

func decodeComfySetupError(err error) (kind string, userMessage string) {
	if err == nil {
		return "", ""
	}

	var setupErr *comfySetupError
	if errors.As(err, &setupErr) {
		return firstNonEmpty(setupErr.kind, comfySetupErrorIncompleteInstall), firstNonEmpty(setupErr.userMessage, "ComfyUI setup failed")
	}

	return comfySetupErrorIncompleteInstall, firstNonEmpty(err.Error(), "ComfyUI setup failed")
}

func cloneComfySetupStatus(input ComfyUISetupStatus) ComfyUISetupStatus {
	cloned := input
	if input.Steps == nil {
		cloned.Steps = []ComfyUISetupStep{}
		return cloned
	}

	cloned.Steps = append([]ComfyUISetupStep(nil), input.Steps...)
	return cloned
}

func (m *ComfyUIManager) GetSetupStatus() ComfyUISetupStatus {
	return m.refreshSetupStatus()
}

func (m *ComfyUIManager) refreshSetupStatus() ComfyUISetupStatus {
	m.mu.RLock()
	if m.setup.State == comfySetupStateInstalling {
		snapshot := cloneComfySetupStatus(m.setup)
		m.mu.RUnlock()
		return snapshot
	}
	m.mu.RUnlock()

	next := m.evaluateSetupStatus()

	m.mu.Lock()
	if m.setup.State != comfySetupStateInstalling {
		m.setup = next
	}
	snapshot := cloneComfySetupStatus(m.setup)
	m.mu.Unlock()

	m.emitSetupStatus()
	return snapshot
}

func (m *ComfyUIManager) evaluateSetupStatus() ComfyUISetupStatus {
	status := defaultComfySetupStatus()
	cfg := m.configMgr.GetComfyUIConfig()

	workspaceRoot, err := resolveWorkspaceRoot(cfg.RootDir)
	if err != nil {
		status.State = comfySetupStateError
		status.ErrorKind = comfySetupErrorWorkspaceInitFailure
		status.StatusMessage = "Pixora could not locate its workspace folder."
		status.LastError = "Pixora could not locate its workspace folder. Move Pixora to a normal writable folder and launch it from there."
		return status
	}

	status.WorkspaceRoot = workspaceRoot
	status.InstallDir = filepath.Join(workspaceRoot, "backend", "comfy")

	if err := cleanupStaleComfyInstallArtifacts(status.InstallDir); err != nil {
		status.State = comfySetupStateError
		status.ErrorKind = comfySetupErrorIncompleteInstall
		status.StatusMessage = "Pixora found leftover files from an interrupted ComfyUI installation."
		status.LastError = "Pixora found leftover files from an interrupted ComfyUI installation. Try installing ComfyUI again."
		return status
	}

	if err := probeWorkspacePermissions(workspaceRoot); err != nil {
		protected := isLikelyProtectedDir(workspaceRoot)
		message := buildWorkspacePermissionMessage(workspaceRoot, protected)

		status.State = comfySetupStateError
		status.ErrorKind = comfySetupErrorPermissionProblem
		status.StatusMessage = message
		status.LastError = message
		status.PermissionProblem = true
		status.PermissionMessage = message
		return status
	}

	if err := ensureWorkspaceFolders(workspaceRoot); err != nil {
		protected := isLikelyProtectedDir(workspaceRoot)
		message := buildWorkspaceInitMessage(workspaceRoot, protected)
		errorKind := comfySetupErrorWorkspaceInitFailure
		if errors.Is(err, os.ErrPermission) {
			errorKind = comfySetupErrorPermissionProblem
		}

		status.State = comfySetupStateError
		status.ErrorKind = errorKind
		status.StatusMessage = message
		status.LastError = message
		status.PermissionProblem = errorKind == comfySetupErrorPermissionProblem
		status.PermissionMessage = message
		return status
	}

	if hasComfyRuntime(workspaceRoot) {
		status.State = comfySetupStateReady
		status.IsInstalled = true
		status.IsReady = true
		status.RequiresOnboarding = false
		status.StatusMessage = "ComfyUI is installed and ready."
		return status
	}

	if _, statErr := os.Stat(status.InstallDir); statErr == nil {
		status.State = comfySetupStateError
		status.IsInstalled = true
		status.IsReady = false
		status.RequiresOnboarding = true
		status.ErrorKind = comfySetupErrorIncompleteInstall
		status.StatusMessage = "ComfyUI installation looks incomplete."
		status.LastError = "ComfyUI files were found, but required files are missing. Reinstall ComfyUI from the onboarding page."
		return status
	} else if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		status.State = comfySetupStateError
		status.ErrorKind = comfySetupErrorIncompleteInstall
		status.StatusMessage = "Pixora could not inspect the ComfyUI installation folder."
		status.LastError = "Pixora could not inspect the ComfyUI installation folder. Check folder permissions and try again."
		return status
	}

	status.State = comfySetupStateMissing
	status.IsInstalled = false
	status.IsReady = false
	status.RequiresOnboarding = true
	status.StatusMessage = "ComfyUI is not installed yet."
	return status
}

func (m *ComfyUIManager) InstallComfyUI() error {
	if runtime.GOOS != "windows" {
		message := "Pixora currently only ships an automatic Windows NVIDIA ComfyUI installer."
		m.failSetupStep("check_environment", comfySetupErrorUnsupportedGPUExpected, message)
		return fmt.Errorf("%s", message)
	}

	cfg := m.configMgr.GetComfyUIConfig()
	workspaceRoot, err := resolveWorkspaceRoot(cfg.RootDir)
	if err != nil {
		setupErr := newComfySetupError(
			comfySetupErrorWorkspaceInitFailure,
			"Pixora could not locate a workspace folder for installation.",
			err,
		)
		m.failSetupStep("check_environment", comfySetupErrorWorkspaceInitFailure, decodeSetupMessage(setupErr))
		return setupErr
	}
	installDir := filepath.Join(workspaceRoot, "backend", "comfy")

	m.mu.Lock()
	if m.setup.State == comfySetupStateInstalling {
		m.mu.Unlock()
		return fmt.Errorf("ComfyUI installation is already running")
	}
	m.setup = defaultComfySetupStatus()
	m.setup.State = comfySetupStateInstalling
	m.setup.StatusMessage = "Installing ComfyUI for Pixora..."
	m.setup.WorkspaceRoot = workspaceRoot
	m.setup.InstallDir = installDir
	m.setup.RequiresOnboarding = true
	m.mu.Unlock()
	m.emitSetupStatus()

	if err := m.stopWithIntent(comfyStopIntentUser); err != nil {
		m.appendLog("warn", "system", fmt.Sprintf("failed to stop ComfyUI before install: %v", err))
	}

	m.setSetupStepRunning("check_environment", "Checking workspace permissions and required folders...")
	if err := probeWorkspacePermissions(workspaceRoot); err != nil {
		protected := isLikelyProtectedDir(workspaceRoot)
		setupErr := newComfySetupError(
			comfySetupErrorPermissionProblem,
			buildWorkspacePermissionMessage(workspaceRoot, protected),
			err,
		)
		return m.completeSetupWithError("check_environment", setupErr)
	}
	if err := ensureWorkspaceFolders(workspaceRoot); err != nil {
		protected := isLikelyProtectedDir(workspaceRoot)
		errorKind := comfySetupErrorWorkspaceInitFailure
		if errors.Is(err, os.ErrPermission) {
			errorKind = comfySetupErrorPermissionProblem
		}
		setupErr := newComfySetupError(
			errorKind,
			buildWorkspaceInitMessage(workspaceRoot, protected),
			err,
		)
		return m.completeSetupWithError("check_environment", setupErr)
	}
	m.setSetupStepCompleted("check_environment", "Workspace is ready.")

	m.setSetupStepRunning("detect_comfy", "Checking for existing ComfyUI installation...")
	comfyAlreadyInstalled := hasComfyRuntime(workspaceRoot)
	if comfyAlreadyInstalled {
		m.setSetupStepCompleted("detect_comfy", "ComfyUI was already installed. Preparing Pixora integration...")
		m.setSetupStepCompleted("download_archive", "Skipped because ComfyUI is already installed.")
		m.setSetupStepCompleted("extract_archive", "Skipped because ComfyUI is already installed.")
		m.setSetupStepCompleted("finalize_install_dir", "Skipped because ComfyUI is already installed.")
	} else {
		m.setSetupStepCompleted("detect_comfy", "ComfyUI is missing. Pixora will install it automatically.")

		installTmpRoot := filepath.Join(workspaceRoot, "backend", ".pixora-comfy-install")
		if err := os.RemoveAll(installTmpRoot); err != nil {
			setupErr := newComfySetupError(
				comfySetupErrorIncompleteInstall,
				"Pixora could not clean temporary installation files.",
				err,
			)
			return m.completeSetupWithError("download_archive", setupErr)
		}
		if err := os.MkdirAll(installTmpRoot, 0755); err != nil {
			setupErr := newComfySetupError(
				comfySetupErrorPermissionProblem,
				"Pixora could not create temporary installation folders. Check folder permissions and try again.",
				err,
			)
			return m.completeSetupWithError("download_archive", setupErr)
		}
		defer func() {
			if removeErr := os.RemoveAll(installTmpRoot); removeErr != nil {
				m.appendLog("warn", "system", fmt.Sprintf("failed to clean temporary installer directory: %v", removeErr))
			}
		}()

		archivePath := filepath.Join(installTmpRoot, comfyInstallArchiveName)
		extractRoot := filepath.Join(installTmpRoot, "extract")

		m.setSetupStepRunning("download_archive", "Downloading ComfyUI archive...")
		if err := downloadFile(comfyInstallArchiveURL, archivePath, func(received int64, total int64, speed float64) {
			m.updateDownloadProgress(received, total, speed)
		}); err != nil {
			setupErr := newComfySetupError(
				comfySetupErrorDownloadFailure,
				"Pixora could not download ComfyUI. Check your internet connection and try again.",
				err,
			)
			return m.completeSetupWithError("download_archive", setupErr)
		}
		m.updateDownloadProgress(0, 0, 0)
		m.setSetupStepCompleted("download_archive", "ComfyUI archive downloaded.")

		m.setSetupStepRunning("extract_archive", "Extracting ComfyUI archive...")
		if err := extractComfyArchive(workspaceRoot, archivePath, extractRoot); err != nil {
			setupErr := newComfySetupError(
				comfySetupErrorExtractionFailure,
				"Pixora could not extract the ComfyUI archive. Please retry installation.",
				err,
			)
			return m.completeSetupWithError("extract_archive", setupErr)
		}
		m.setSetupStepCompleted("extract_archive", "ComfyUI archive extracted.")

		m.setSetupStepRunning("finalize_install_dir", "Finalizing installation folder...")
		if err := installExtractedComfy(workspaceRoot, extractRoot); err != nil {
			return m.completeSetupWithError("finalize_install_dir", err)
		}
		m.setSetupStepCompleted("finalize_install_dir", "ComfyUI installed to backend/comfy.")
	}

	if !hasComfyRuntime(workspaceRoot) {
		setupErr := newComfySetupError(
			comfySetupErrorIncompleteInstall,
			"ComfyUI installation did not complete. Required runtime files are still missing.",
			nil,
		)
		return m.completeSetupWithError("finalize_install_dir", setupErr)
	}

	m.setSetupStepRunning("prepare_model_paths", "Preparing Pixora model folders and extra model paths...")
	if err := m.prepareRuntimeAfterInstall(workspaceRoot); err != nil {
		return m.completeSetupWithError("prepare_model_paths", err)
	}
	m.setSetupStepCompleted("prepare_model_paths", "Model paths prepared.")

	m.setSetupStepRunning("copy_custom_nodes", "Copying Pixora custom nodes into ComfyUI...")
	if err := ensureComfyCustomNodesDir(workspaceRoot); err != nil {
		setupErr := newComfySetupError(
			comfySetupErrorIncompleteInstall,
			"Pixora could not prepare the ComfyUI custom_nodes folder.",
			err,
		)
		return m.completeSetupWithError("copy_custom_nodes", setupErr)
	}
	if err := m.syncBundledCustomNodes(workspaceRoot); err != nil {
		setupErr := newComfySetupError(
			comfySetupErrorIncompleteInstall,
			"Pixora could not copy custom nodes into ComfyUI.",
			err,
		)
		return m.completeSetupWithError("copy_custom_nodes", setupErr)
	}
	m.setSetupStepCompleted("copy_custom_nodes", "Custom nodes copied successfully.")

	m.setSetupStepRunning("complete", "Finishing installation...")
	if !hasComfyRuntime(workspaceRoot) {
		setupErr := newComfySetupError(
			comfySetupErrorIncompleteInstall,
			"ComfyUI setup is still incomplete after installation.",
			nil,
		)
		return m.completeSetupWithError("complete", setupErr)
	}
	m.setSetupStepCompleted("complete", "ComfyUI installation is complete. You can start generating images.")
	m.completeSetupSuccess()
	m.refreshSetupStatus()
	return nil
}

func (m *ComfyUIManager) prepareRuntimeAfterInstall(workspaceRoot string) error {
	cfg := m.configMgr.GetComfyUIConfig()
	cfg.RootDir = workspaceRoot

	normalized, err := m.prepareRuntimeConfig(cfg)
	if err != nil {
		return newComfySetupError(
			comfySetupErrorIncompleteInstall,
			"ComfyUI was installed, but Pixora could not prepare runtime paths.",
			err,
		)
	}

	if err := m.configMgr.SetComfyUIConfig(normalized); err != nil {
		return newComfySetupError(
			comfySetupErrorIncompleteInstall,
			"ComfyUI was installed, but Pixora could not save runtime configuration.",
			err,
		)
	}

	return nil
}

func resolveWorkspaceRoot(configured string) (string, error) {
	candidates := make([]string, 0, 8)
	if trimmed := strings.TrimSpace(configured); trimmed != "" {
		root := trimmed
		if !filepath.IsAbs(root) {
			cwd, err := os.Getwd()
			if err != nil {
				return "", fmt.Errorf("get working directory: %w", err)
			}
			root = filepath.Join(cwd, root)
		}
		candidates = append(candidates, root)
	}

	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates, exeDir, filepath.Dir(exeDir))
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, cwd, filepath.Dir(cwd))
	}

	seen := map[string]struct{}{}
	fallback := ""

	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == "" {
			continue
		}

		candidate = filepath.Clean(candidate)
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}

		if fallback == "" {
			fallback = candidate
		}

		if hasWorkspaceLayout(candidate) {
			return candidate, nil
		}
	}

	if fallback != "" {
		return fallback, nil
	}

	return "", fmt.Errorf("workspace root not found")
}

func hasWorkspaceLayout(root string) bool {
	if strings.TrimSpace(root) == "" {
		return false
	}

	backendPath := filepath.Join(root, "backend")
	if info, err := os.Stat(backendPath); err == nil && info.IsDir() {
		return true
	}

	if _, err := os.Stat(filepath.Join(root, "go.mod")); err == nil {
		return true
	}

	return false
}

func requiredWorkspaceDirectories(root string) []string {
	dirs := []string{
		filepath.Join(root, "data", "output"),
		filepath.Join(root, "data", "completion"),
	}

	seen := map[string]struct{}{}
	for _, subdir := range comfyModelSubdirs {
		joined := filepath.Join(root, "data", "sd", subdir)
		if _, ok := seen[joined]; ok {
			continue
		}
		seen[joined] = struct{}{}
		dirs = append(dirs, joined)
	}

	return dirs
}

func ensureWorkspaceFolders(workspaceRoot string) error {
	for _, dir := range requiredWorkspaceDirectories(workspaceRoot) {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("create folder %s: %w", dir, err)
		}
	}

	return nil
}

func probeWorkspacePermissions(workspaceRoot string) error {
	if _, err := os.ReadDir(workspaceRoot); err != nil {
		return fmt.Errorf("read workspace directory: %w", err)
	}

	probeFile, err := os.CreateTemp(workspaceRoot, ".pixora-permission-probe-*")
	if err != nil {
		return fmt.Errorf("create temporary file in workspace: %w", err)
	}
	probePath := probeFile.Name()

	if _, err := probeFile.WriteString("pixora-permission-check"); err != nil {
		_ = probeFile.Close()
		_ = os.Remove(probePath)
		return fmt.Errorf("write temporary file in workspace: %w", err)
	}

	if err := probeFile.Close(); err != nil {
		_ = os.Remove(probePath)
		return fmt.Errorf("close temporary file in workspace: %w", err)
	}

	if _, err := os.ReadFile(probePath); err != nil {
		_ = os.Remove(probePath)
		return fmt.Errorf("read temporary file in workspace: %w", err)
	}

	if err := os.Remove(probePath); err != nil {
		return fmt.Errorf("remove temporary file in workspace: %w", err)
	}

	return nil
}

func isLikelyProtectedDir(path string) bool {
	normalized := strings.ToLower(filepath.ToSlash(filepath.Clean(path)))
	protectedMarkers := []string{
		"/program files",
		"/program files (x86)",
		"/windows",
		"/windowsapps",
	}

	for _, marker := range protectedMarkers {
		if strings.Contains(normalized, marker) {
			return true
		}
	}

	return false
}

func buildWorkspacePermissionMessage(workspaceRoot string, isProtected bool) string {
	if isProtected {
		return fmt.Sprintf(
			"Pixora is running from a protected folder (%s). It cannot reliably read/write files there without administrator rights. Running as Administrator is not recommended. Move or reinstall Pixora to a normal folder such as Desktop, Documents, or another writable location.",
			workspaceRoot,
		)
	}

	return fmt.Sprintf(
		"Pixora cannot write to its current folder (%s). Pixora needs normal read/write access to run correctly. Running as Administrator is not recommended. Move or reinstall Pixora to a writable folder and try again.",
		workspaceRoot,
	)
}

func buildWorkspaceInitMessage(workspaceRoot string, isProtected bool) string {
	if isProtected {
		return fmt.Sprintf(
			"Pixora could not create required workspace folders in %s because the location is protected. Running as Administrator is not recommended. Move or reinstall Pixora to a normal writable folder and try again.",
			workspaceRoot,
		)
	}

	return fmt.Sprintf(
		"Pixora could not create required workspace folders in %s. Check folder permissions and ensure the location is writable, then try again.",
		workspaceRoot,
	)
}

func cleanupStaleComfyInstallArtifacts(installDir string) error {
	stagingDir := installDir + ".installing"
	info, err := os.Stat(stagingDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("stat stale staging directory: %w", err)
	}

	if !info.IsDir() {
		if removeErr := os.Remove(stagingDir); removeErr != nil {
			return fmt.Errorf("remove stale staging file: %w", removeErr)
		}
		return nil
	}

	if removeErr := os.RemoveAll(stagingDir); removeErr != nil {
		return fmt.Errorf("remove stale staging directory: %w", removeErr)
	}

	return nil
}

func downloadFile(url string, destination string, onProgress func(received int64, total int64, speed float64)) error {
	client := &http.Client{
		Timeout: 90 * time.Minute,
	}

	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("request download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected download status: %d", resp.StatusCode)
	}

	targetFile, err := os.Create(destination)
	if err != nil {
		return fmt.Errorf("create destination file: %w", err)
	}
	defer targetFile.Close()

	totalBytes := resp.ContentLength
	buf := make([]byte, 512*1024)
	var downloadedBytes int64
	startedAt := time.Now()
	lastReportAt := time.Time{}

	reportProgress := func(force bool) {
		if onProgress == nil {
			return
		}
		if !force && !lastReportAt.IsZero() && time.Since(lastReportAt) < 250*time.Millisecond {
			return
		}

		elapsed := time.Since(startedAt).Seconds()
		speed := 0.0
		if elapsed > 0 {
			speed = float64(downloadedBytes) / elapsed
		}
		lastReportAt = time.Now()
		onProgress(downloadedBytes, totalBytes, speed)
	}

	reportProgress(true)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := targetFile.Write(buf[:n]); writeErr != nil {
				return fmt.Errorf("write downloaded archive: %w", writeErr)
			}
			downloadedBytes += int64(n)
			reportProgress(false)
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				reportProgress(true)
				break
			}
			return fmt.Errorf("read archive payload: %w", readErr)
		}
	}

	return nil
}

func (m *ComfyUIManager) updateDownloadProgress(received int64, total int64, speed float64) {
	m.mu.Lock()
	if m.setup.CurrentStepID != "download_archive" || m.setup.State != comfySetupStateInstalling {
		m.mu.Unlock()
		return
	}

	if received < 0 {
		received = 0
	}
	if total < 0 {
		total = 0
	}
	if speed < 0 {
		speed = 0
	}

	progress := 0.0
	if total > 0 {
		progress = (float64(received) / float64(total)) * 100
		if progress < 0 {
			progress = 0
		}
		if progress > 100 {
			progress = 100
		}
	}

	m.setup.DownloadProgress = progress
	m.setup.DownloadedBytes = received
	m.setup.TotalBytes = total
	m.setup.DownloadSpeed = speed

	sizePart := fmt.Sprintf("%s downloaded", formatByteSize(received))
	if total > 0 {
		sizePart = fmt.Sprintf("%s / %s", formatByteSize(received), formatByteSize(total))
	}

	message := fmt.Sprintf("Downloading ComfyUI archive... %s at %s/s", sizePart, formatByteSize(int64(speed)))
	if total > 0 {
		message = fmt.Sprintf("Downloading ComfyUI archive... %.1f%% (%s) at %s/s", progress, sizePart, formatByteSize(int64(speed)))
	}

	m.setup.CurrentStepMessage = message
	m.setup.StatusMessage = message
	for i := range m.setup.Steps {
		if m.setup.Steps[i].ID != "download_archive" {
			continue
		}
		m.setup.Steps[i].Message = message
	}
	m.mu.Unlock()

	m.emitSetupStatus()
}

func formatByteSize(bytes int64) string {
	if bytes <= 0 {
		return "0 B"
	}

	const unit = 1024.0
	value := float64(bytes)
	units := []string{"B", "KB", "MB", "GB", "TB"}
	idx := 0

	for value >= unit && idx < len(units)-1 {
		value /= unit
		idx++
	}

	if value >= 10 || idx == 0 {
		return fmt.Sprintf("%.0f %s", value, units[idx])
	}
	return fmt.Sprintf("%.1f %s", value, units[idx])
}

func extractComfyArchive(workspaceRoot string, archivePath string, outputDir string) error {
	sevenZipPath := filepath.Join(workspaceRoot, "backend", "ext", "7za.exe")
	if _, err := os.Stat(sevenZipPath); err != nil {
		return fmt.Errorf("required extractor not found at %s", sevenZipPath)
	}

	if err := os.RemoveAll(outputDir); err != nil {
		return fmt.Errorf("clean extract directory: %w", err)
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("create extract directory: %w", err)
	}

	cmd := exec.Command(sevenZipPath, "x", "-y", fmt.Sprintf("-o%s", outputDir), archivePath)
	configureComfyProcess(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("extract archive with 7za failed: %w, output=%s", err, strings.TrimSpace(string(output)))
	}

	return nil
}

func installExtractedComfy(workspaceRoot string, extractRoot string) error {
	extractedDir := filepath.Join(extractRoot, comfyInstallExtractedFolder)
	installDir := filepath.Join(workspaceRoot, "backend", "comfy")
	stagingDir := installDir + ".installing"
	backupDir := installDir + ".backup." + fmt.Sprintf("%d", time.Now().UnixNano())

	if err := cleanupStaleComfyInstallArtifacts(installDir); err != nil {
		return newComfySetupError(
			comfySetupErrorIncompleteInstall,
			"Pixora could not clean stale ComfyUI installation artifacts.",
			err,
		)
	}

	if _, err := os.Stat(extractedDir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return newComfySetupError(
				comfySetupErrorInvalidArchive,
				"The ComfyUI archive did not contain the expected folder structure.",
				err,
			)
		}
		return newComfySetupError(
			comfySetupErrorInvalidArchive,
			"Pixora could not inspect the extracted ComfyUI archive.",
			err,
		)
	}

	if err := os.Rename(extractedDir, stagingDir); err != nil {
		return newComfySetupError(
			comfySetupErrorInvalidArchive,
			"Pixora could not stage extracted ComfyUI files.",
			err,
		)
	}

	backupCreated := false
	if _, err := os.Stat(installDir); err == nil {
		if renameErr := os.Rename(installDir, backupDir); renameErr != nil {
			_ = os.RemoveAll(stagingDir)
			return newComfySetupError(
				comfySetupErrorIncompleteInstall,
				"Pixora could not replace the previous ComfyUI folder.",
				renameErr,
			)
		}
		backupCreated = true
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = os.RemoveAll(stagingDir)
		return newComfySetupError(
			comfySetupErrorIncompleteInstall,
			"Pixora could not inspect the current ComfyUI folder.",
			err,
		)
	}

	if err := os.Rename(stagingDir, installDir); err != nil {
		_ = os.RemoveAll(stagingDir)
		if backupCreated {
			_ = os.Rename(backupDir, installDir)
		}
		return newComfySetupError(
			comfySetupErrorIncompleteInstall,
			"Pixora could not finalize ComfyUI installation folder.",
			err,
		)
	}

	rootHasRuntime := hasComfyRuntime(workspaceRoot)
	if !rootHasRuntime {
		_ = os.RemoveAll(installDir)
		if backupCreated {
			_ = os.Rename(backupDir, installDir)
		}
		return newComfySetupError(
			comfySetupErrorIncompleteInstall,
			"ComfyUI installation finished, but required runtime files are missing.",
			nil,
		)
	}

	if backupCreated {
		if err := os.RemoveAll(backupDir); err != nil {
			return newComfySetupError(
				comfySetupErrorIncompleteInstall,
				"ComfyUI was installed, but Pixora could not remove backup installation files.",
				err,
			)
		}
	}

	return nil
}

func ensureComfyCustomNodesDir(workspaceRoot string) error {
	customNodesPath := filepath.Join(workspaceRoot, "backend", "comfy", "ComfyUI", "custom_nodes")
	if err := os.MkdirAll(customNodesPath, 0755); err != nil {
		return err
	}
	return nil
}

func (m *ComfyUIManager) setSetupStepRunning(stepID string, message string) {
	stepMessage := strings.TrimSpace(message)
	m.mu.Lock()
	m.setup.State = comfySetupStateInstalling
	m.setup.CurrentStepID = stepID
	m.setup.CurrentStepMessage = stepMessage
	m.setup.StatusMessage = firstNonEmpty(message, m.setup.StatusMessage)
	if stepID != "download_archive" {
		m.setup.DownloadProgress = 0
		m.setup.DownloadedBytes = 0
		m.setup.TotalBytes = 0
		m.setup.DownloadSpeed = 0
	}
	for i := range m.setup.Steps {
		if m.setup.Steps[i].ID != stepID {
			continue
		}
		m.setup.Steps[i].Status = comfySetupStepRunning
		m.setup.Steps[i].Message = stepMessage
	}
	m.mu.Unlock()

	m.emitSetupStatus()
	m.appendLog("info", "setup", fmt.Sprintf("[%s] %s", stepID, stepMessage))
}

func (m *ComfyUIManager) setSetupStepCompleted(stepID string, message string) {
	stepMessage := strings.TrimSpace(message)
	m.mu.Lock()
	m.setup.CurrentStepID = stepID
	m.setup.CurrentStepMessage = stepMessage
	m.setup.StatusMessage = firstNonEmpty(message, m.setup.StatusMessage)
	m.setup.DownloadProgress = 0
	m.setup.DownloadedBytes = 0
	m.setup.TotalBytes = 0
	m.setup.DownloadSpeed = 0
	for i := range m.setup.Steps {
		if m.setup.Steps[i].ID != stepID {
			continue
		}
		m.setup.Steps[i].Status = comfySetupStepCompleted
		m.setup.Steps[i].Message = stepMessage
	}
	m.mu.Unlock()

	m.emitSetupStatus()
	m.appendLog("info", "setup", fmt.Sprintf("[%s] %s", stepID, stepMessage))
}

func (m *ComfyUIManager) failSetupStep(stepID string, errorKind string, message string) {
	m.mu.Lock()
	userMessage := firstNonEmpty(message, "ComfyUI setup failed")
	m.setup.State = comfySetupStateError
	m.setup.CurrentStepID = stepID
	m.setup.CurrentStepMessage = userMessage
	m.setup.StatusMessage = userMessage
	m.setup.LastError = userMessage
	m.setup.ErrorKind = firstNonEmpty(errorKind, comfySetupErrorIncompleteInstall)
	m.setup.IsReady = false
	m.setup.RequiresOnboarding = true
	m.setup.DownloadProgress = 0
	m.setup.DownloadedBytes = 0
	m.setup.TotalBytes = 0
	m.setup.DownloadSpeed = 0
	if m.setup.ErrorKind == comfySetupErrorPermissionProblem {
		m.setup.PermissionProblem = true
		m.setup.PermissionMessage = userMessage
	}

	for i := range m.setup.Steps {
		if m.setup.Steps[i].ID != stepID {
			continue
		}
		m.setup.Steps[i].Status = comfySetupStepError
		m.setup.Steps[i].Message = userMessage
	}
	m.mu.Unlock()

	m.emitSetupStatus()
	m.appendLog("error", "system", userMessage)
}

func (m *ComfyUIManager) completeSetupWithError(stepID string, err error) error {
	kind, userMessage := decodeComfySetupError(err)
	m.failSetupStep(stepID, kind, userMessage)
	return fmt.Errorf("%s", userMessage)
}

func (m *ComfyUIManager) completeSetupSuccess() {
	m.mu.Lock()
	m.setup.State = comfySetupStateReady
	m.setup.IsReady = true
	m.setup.IsInstalled = true
	m.setup.RequiresOnboarding = false
	m.setup.LastError = ""
	m.setup.ErrorKind = ""
	m.setup.PermissionProblem = false
	m.setup.PermissionMessage = ""
	m.setup.DownloadProgress = 0
	m.setup.DownloadedBytes = 0
	m.setup.TotalBytes = 0
	m.setup.DownloadSpeed = 0
	m.setup.CurrentStepID = "complete"
	m.setup.CurrentStepMessage = "ComfyUI installation is complete."
	m.setup.StatusMessage = "ComfyUI is installed and ready."
	m.mu.Unlock()

	m.emitSetupStatus()
}

func decodeSetupMessage(err error) string {
	_, userMessage := decodeComfySetupError(err)
	return userMessage
}
