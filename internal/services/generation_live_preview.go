package services

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	livePreviewPathPrefix = "/preview/live/"
	maxLivePreviewEntries = 12
	maxLivePreviewBytes   = 32 * 1024 * 1024
)

type livePreviewFrame struct {
	contentType string
	data        []byte
	version     int64
	updatedAt   time.Time
}

func (s *GenerationService) cacheLivePreviewFrame(promptID string, imageBytes []byte, ext string) string {
	normalizedPromptID := strings.TrimSpace(promptID)
	if normalizedPromptID == "" || len(imageBytes) == 0 {
		return ""
	}

	contentType := livePreviewContentType(ext)
	now := time.Now()

	s.previewMu.Lock()
	defer s.previewMu.Unlock()

	entry, hasExisting := s.previewCache[normalizedPromptID]
	if hasExisting {
		s.previewBytes -= int64(len(entry.data))
	}

	// Copy frame bytes so we don't retain/serve a mutable websocket buffer.
	frameCopy := make([]byte, len(imageBytes))
	copy(frameCopy, imageBytes)

	entry.version++
	entry.data = frameCopy
	entry.contentType = contentType
	entry.updatedAt = now

	s.previewCache[normalizedPromptID] = entry
	s.previewBytes += int64(len(frameCopy))
	s.enforceLivePreviewLimitsLocked(normalizedPromptID)

	return livePreviewPathPrefix + url.PathEscape(normalizedPromptID) + "?v=" + strconv.FormatInt(entry.version, 10)
}

func (s *GenerationService) clearLivePreviewFrame(promptID string) {
	normalizedPromptID := strings.TrimSpace(promptID)
	if normalizedPromptID == "" {
		return
	}

	s.previewMu.Lock()
	defer s.previewMu.Unlock()

	entry, ok := s.previewCache[normalizedPromptID]
	if !ok {
		return
	}

	s.previewBytes -= int64(len(entry.data))
	delete(s.previewCache, normalizedPromptID)
}

func (s *GenerationService) enforceLivePreviewLimitsLocked(currentPromptID string) {
	for len(s.previewCache) > maxLivePreviewEntries || s.previewBytes > maxLivePreviewBytes {
		evictPromptID := ""
		var oldestTime time.Time
		for promptID, entry := range s.previewCache {
			if promptID == currentPromptID && len(s.previewCache) > 1 {
				continue
			}
			if evictPromptID == "" || entry.updatedAt.Before(oldestTime) {
				evictPromptID = promptID
				oldestTime = entry.updatedAt
			}
		}

		if evictPromptID == "" {
			break
		}

		evictEntry := s.previewCache[evictPromptID]
		s.previewBytes -= int64(len(evictEntry.data))
		delete(s.previewCache, evictPromptID)
	}
}

func livePreviewContentType(ext string) string {
	switch strings.ToLower(strings.TrimSpace(ext)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

func ServeGenerationLivePreview(svc *GenerationService, w http.ResponseWriter, r *http.Request) {
	if svc == nil {
		http.NotFound(w, r)
		return
	}

	svc.serveLivePreview(w, r)
}

func (s *GenerationService) serveLivePreview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if !strings.HasPrefix(r.URL.Path, livePreviewPathPrefix) {
		http.NotFound(w, r)
		return
	}

	encodedPromptID := strings.TrimPrefix(r.URL.Path, livePreviewPathPrefix)
	if strings.TrimSpace(encodedPromptID) == "" {
		http.NotFound(w, r)
		return
	}

	promptID, err := url.PathUnescape(encodedPromptID)
	if err != nil || strings.TrimSpace(promptID) == "" {
		http.NotFound(w, r)
		return
	}

	s.previewMu.RLock()
	entry, ok := s.previewCache[promptID]
	s.previewMu.RUnlock()
	if !ok || len(entry.data) == 0 {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", entry.contentType)
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.Header().Set("Content-Length", strconv.Itoa(len(entry.data)))

	if r.Method == http.MethodHead {
		return
	}

	_, _ = w.Write(entry.data)
}
