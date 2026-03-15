package services

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"pixora/internal/config"
	"pixora/internal/db"
	"runtime"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type GalleryService struct {
	db      *db.DB
	config  *config.Manager
	indexer *Indexer
	window  *application.WebviewWindow
	plugins *ParserPluginManager
}

func NewGalleryService(database *db.DB, cfg *config.Manager, idx *Indexer, plugins *ParserPluginManager) *GalleryService {
	return &GalleryService{
		db:      database,
		config:  cfg,
		indexer: idx,
		plugins: plugins,
	}
}

type PaginatedImages struct {
	Images     []db.ImageRecord `json:"images"`
	TotalCount int              `json:"totalCount"`
	Offset     int              `json:"offset"`
	Limit      int              `json:"limit"`
}

// GetImages returns a paginated list of images, optionally matching a search query and filtered by folder.
func (s *GalleryService) GetImages(query string, folderPath string, offset, limit int, sortBy string, direction string) (*PaginatedImages, error) {
	// Let's implement this in db.go next
	// This will use FTS5 if query is not empty
	images, total, err := s.db.SearchImages(context.Background(), query, folderPath, offset, limit, sortBy, direction)
	if err != nil {
		return nil, err
	}

	return &PaginatedImages{
		Images:     images,
		TotalCount: total,
		Offset:     offset,
		Limit:      limit,
	}, nil
}

// GetConfig returns the application configuration.
func (s *GalleryService) GetConfig() config.AppConfig {
	return s.config.GetConfig()
}

// AddFolder adds a new supervised folder and triggers a scan.
func (s *GalleryService) AddFolder(path string, mode config.ScanMode) error {
	err := s.config.AddFolder(path, mode)
	if err != nil {
		return err
	}

	// Trigger scan for this new folder immediately
	go s.indexer.ScanFolder(config.FolderConfig{Path: path, ScanMode: mode})
	return nil
}

// RemoveFolder removes a supervised folder and purges indexed images immediately.
func (s *GalleryService) RemoveFolder(path string) error {
	s.indexer.StopScan(path)
	err := s.config.RemoveFolder(path)
	if err != nil {
		return err
	}

	ctx := context.Background()
	hashes, err := s.db.RemoveImagesByFolder(ctx, path)
	if err != nil {
		return err
	}

	if err := s.indexer.thumbnailSvc.DeleteMany(hashes); err != nil {
		return err
	}

	return s.db.CheckpointWAL(ctx)
}

// OpenExternally opens a file using the default OS application
func (s *GalleryService) OpenExternally(path string) error {
	cmd, err := buildOpenCommand(path)
	if err != nil {
		return err
	}

	return cmd.Start()
}

// ShowInFolder opens the file explorer and selects the file
func (s *GalleryService) ShowInFolder(path string) error {
	cmd, err := buildShowInFolderCommand(path)
	if err != nil {
		return err
	}

	return cmd.Start()
}

func buildOpenCommand(path string) (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("cmd", "/c", "start", "", path), nil
	case "darwin":
		return exec.Command("open", path), nil
	case "linux":
		return exec.Command("xdg-open", path), nil
	default:
		return nil, fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

func buildShowInFolderCommand(path string) (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer", "/select,", path), nil
	case "darwin":
		return exec.Command("open", "-R", path), nil
	case "linux":
		return exec.Command("xdg-open", filepath.Dir(path)), nil
	default:
		return nil, fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

// SetTabs updates the tabs configuration.
func (s *GalleryService) SetTabs(tabs []config.TabConfig) error {
	return s.config.SetTabs(tabs)
}

// UpdateFolderAlias updates the alias for a supervised folder.
func (s *GalleryService) UpdateFolderAlias(path string, alias string) error {
	return s.config.UpdateFolderAlias(path, alias)
}

// SetDevMode updates the dev mode setting.
func (s *GalleryService) SetDevMode(enabled bool) error {
	return s.config.SetDevMode(enabled)
}

// SetWindow sets the main window for the service.
func (s *GalleryService) SetWindow(window *application.WebviewWindow) {
	s.window = window
}

// ToggleDevTools opens or closes the developer tools.
func (s *GalleryService) ToggleDevTools() {
	if s.window != nil {
		s.window.OpenDevTools()
	}
}

// ClearIndexAndReindex clears indexed image data and thumbnail cache, then starts a fresh scan.
func (s *GalleryService) ClearIndexAndReindex() error {
	ctx := context.Background()
	s.indexer.StopAllScans()

	if err := s.db.ClearImages(ctx); err != nil {
		return err
	}

	if err := s.indexer.thumbnailSvc.ClearCache(); err != nil {
		return err
	}

	if err := s.db.CheckpointWAL(ctx); err != nil {
		return err
	}

	// Let canceled scans finish unwinding before triggering a full rescan.
	time.Sleep(150 * time.Millisecond)
	go s.indexer.ScanAll()

	return nil
}

// ListParserPlugins returns all parser plugins detected in the plugins directory.
func (s *GalleryService) ListParserPlugins() ([]ParserPluginInfo, error) {
	if s.plugins == nil {
		return []ParserPluginInfo{}, nil
	}

	if err := s.plugins.Reload(); err != nil {
		return nil, err
	}

	return s.plugins.List(), nil
}

// SetParserPluginEnabled enables or disables a trusted plugin.
func (s *GalleryService) SetParserPluginEnabled(pluginID string, enabled bool) error {
	if s.plugins == nil {
		return nil
	}

	return s.plugins.SetEnabled(pluginID, enabled)
}

// TrustParserPlugin marks a plugin as trusted. Trusted plugins can be enabled.
func (s *GalleryService) TrustParserPlugin(pluginID string) error {
	if s.plugins == nil {
		return nil
	}

	return s.plugins.Trust(pluginID, true)
}

// UntrustParserPlugin revokes trust and disables the plugin.
func (s *GalleryService) UntrustParserPlugin(pluginID string) error {
	if s.plugins == nil {
		return nil
	}

	return s.plugins.Trust(pluginID, false)
}

// InstallParserPlugin installs a plugin from a zip package.
func (s *GalleryService) InstallParserPlugin(zipPath string) (*ParserPluginInfo, error) {
	if s.plugins == nil {
		return nil, nil
	}

	return s.plugins.Install(zipPath)
}

// RemoveParserPlugin removes an installed plugin directory and state.
func (s *GalleryService) RemoveParserPlugin(pluginID string) error {
	if s.plugins == nil {
		return nil
	}

	return s.plugins.Remove(pluginID)
}

// RefetchImageMetadata reparses metadata for a single image and persists the result.
// mode supports: "default" (built-in parser) and "plugin" (built-in + specific plugin override).
func (s *GalleryService) RefetchImageMetadata(path string, mode string, pluginID string) (*db.ImageRecord, error) {
	refetchMode := MetadataRefetchMode(mode)
	if refetchMode != MetadataRefetchModePlugin {
		refetchMode = MetadataRefetchModeDefault
	}

	return s.indexer.RefetchMetadata(path, refetchMode, pluginID)
}

// ListParserPluginLogs returns recent plugin runtime logs for debugging.
func (s *GalleryService) ListParserPluginLogs(pluginID string, limit int) []ParserPluginLogEntry {
	if s.plugins == nil {
		return []ParserPluginLogEntry{}
	}

	return s.plugins.ListLogs(pluginID, limit)
}

// ClearParserPluginLogs clears the in-memory plugin debug console log buffer.
func (s *GalleryService) ClearParserPluginLogs() {
	if s.plugins == nil {
		return
	}

	s.plugins.ClearLogs()
}
