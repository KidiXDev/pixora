package services

import (
	"fmt"
	"os"
	"path/filepath"
	"pixora/internal/config"
	"strings"
)

func resolveGenerationModelsRoot(cfg config.ComfyUIBackendConfig) (string, error) {
	candidateRoots := resolveGenerationDataRootCandidates(cfg)
	for _, root := range candidateRoots {
		modelsRoot := filepath.Join(root, "data", "sd")
		if info, err := os.Stat(modelsRoot); err == nil && info.IsDir() {
			return modelsRoot, nil
		}
	}

	return "", fmt.Errorf("stat models root: %w", os.ErrNotExist)
}

func resolveGenerationCompletionRoot(cfg config.ComfyUIBackendConfig) (string, error) {
	candidateRoots := resolveGenerationDataRootCandidates(cfg)
	for _, root := range candidateRoots {
		completionRoot := filepath.Join(root, "data", "completion")
		if info, err := os.Stat(completionRoot); err == nil && info.IsDir() {
			return completionRoot, nil
		}
	}

	return "", fmt.Errorf("read completion directory: %w", os.ErrNotExist)
}

func resolveGenerationOutputBaseDir(cfg config.ComfyUIBackendConfig, baseOutput string) string {
	trimmedOutput := strings.TrimSpace(baseOutput)
	if trimmedOutput == "" {
		trimmedOutput = filepath.Join("data", "output")
	}

	if filepath.IsAbs(trimmedOutput) {
		return filepath.Clean(trimmedOutput)
	}

	for _, root := range resolveGenerationDataRootCandidates(cfg) {
		candidate := filepath.Clean(filepath.Join(root, trimmedOutput))
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}

	if cwd, err := os.Getwd(); err == nil {
		return filepath.Clean(filepath.Join(cwd, trimmedOutput))
	}

	return filepath.Clean(trimmedOutput)
}

func resolveGenerationDataRootCandidates(cfg config.ComfyUIBackendConfig) []string {
	candidates := make([]string, 0, 8)
	seen := make(map[string]struct{}, 8)

	appendCandidate := func(path string) {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			return
		}
		normalized := filepath.Clean(trimmed)
		if _, ok := seen[normalized]; ok {
			return
		}
		seen[normalized] = struct{}{}
		candidates = append(candidates, normalized)
	}

	if cwd, err := os.Getwd(); err == nil {
		appendCandidate(cwd)
	}

	configuredRoot := strings.TrimSpace(cfg.RootDir)
	if configuredRoot != "" {
		if filepath.IsAbs(configuredRoot) {
			appendCandidate(configuredRoot)
		} else {
			if cwd, err := os.Getwd(); err == nil {
				appendCandidate(filepath.Join(cwd, configuredRoot))
			}
			appendCandidate(configuredRoot)
		}
	}

	if runtimeRoot, err := resolveRuntimeRoot(cfg.RootDir); err == nil {
		appendCandidate(runtimeRoot)
	}

	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		appendCandidate(exeDir)
		appendCandidate(filepath.Dir(exeDir))
	}

	return candidates
}
