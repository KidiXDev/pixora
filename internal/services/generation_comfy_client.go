package services

import (
	"bytes"
	"context"
	"encoding/base64"
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
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

func (s *GenerationService) generateText2ImageInternal(ctx context.Context, req GenerationRequest, overridePromptID string, onPromptQueued func(string)) (*GenerationResult, error) {
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
	if onPromptQueued != nil {
		onPromptQueued(promptID)
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

func interruptComfyGeneration(baseURL string, promptID string) error {
	endpoint := fmt.Sprintf("%s/interrupt", baseURL)

	var body io.Reader
	if strings.TrimSpace(promptID) != "" {
		payload, err := json.Marshal(map[string]string{
			"prompt_id": strings.TrimSpace(promptID),
		})
		if err != nil {
			return fmt.Errorf("serialize comfy interrupt payload: %w", err)
		}
		body = bytes.NewReader(payload)
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, body)
	if err != nil {
		return fmt.Errorf("create comfy interrupt request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request comfy interrupt: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("comfy interrupt failed: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	return nil
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
