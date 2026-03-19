package services

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"pixora/internal/config"
	"pixora/internal/db"
	"runtime"
	"strings"
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

type FolderEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type FolderBrowseResponse struct {
	RootPath    string           `json:"rootPath"`
	CurrentPath string           `json:"currentPath"`
	ParentPath  string           `json:"parentPath"`
	Folders     []FolderEntry    `json:"folders"`
	Images      []db.ImageRecord `json:"images"`
	TotalCount  int              `json:"totalCount"`
	Offset      int              `json:"offset"`
	Limit       int              `json:"limit"`
}

func (s *GalleryService) GetImages(query string, folderPath string, offset, limit int, sortBy string, direction string) (*PaginatedImages, error) {
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

func (s *GalleryService) BrowseFolder(query string, rootPath string, currentPath string, offset, limit int, sortBy string, direction string) (*FolderBrowseResponse, error) {
	normalizedRoot := strings.TrimSpace(filepath.Clean(rootPath))
	if normalizedRoot == "" {
		return &FolderBrowseResponse{
			RootPath:    "",
			CurrentPath: "",
			ParentPath:  "",
			Folders:     []FolderEntry{},
			Images:      []db.ImageRecord{},
			TotalCount:  0,
			Offset:      offset,
			Limit:       limit,
		}, nil
	}

	normalizedCurrent := normalizedRoot
	trimmedCurrent := strings.TrimSpace(currentPath)
	if trimmedCurrent != "" {
		candidate := filepath.Clean(trimmedCurrent)
		if pathWithinRoot(candidate, normalizedRoot) {
			normalizedCurrent = candidate
		}
	}

	result, err := s.db.BrowseFolder(context.Background(), normalizedCurrent, query, offset, limit, sortBy, direction)
	if err != nil {
		return nil, err
	}

	parentPath := ""
	if normalizedCurrent != normalizedRoot {
		parent := filepath.Dir(normalizedCurrent)
		if parent != "" && pathWithinRoot(parent, normalizedRoot) {
			parentPath = parent
		}
	}

	folders, err := listDirectFolders(normalizedCurrent, query)
	if err != nil {
		return nil, err
	}

	return &FolderBrowseResponse{
		RootPath:    normalizedRoot,
		CurrentPath: normalizedCurrent,
		ParentPath:  parentPath,
		Folders:     folders,
		Images:      result.Images,
		TotalCount:  result.TotalImages,
		Offset:      offset,
		Limit:       limit,
	}, nil
}

func listDirectFolders(currentPath string, query string) ([]FolderEntry, error) {
	entries, err := os.ReadDir(currentPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []FolderEntry{}, nil
		}
		return nil, err
	}

	queryLower := strings.ToLower(strings.TrimSpace(query))
	folders := make([]FolderEntry, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		name := strings.TrimSpace(entry.Name())
		if name == "" {
			continue
		}

		if queryLower != "" && !strings.Contains(strings.ToLower(name), queryLower) {
			continue
		}

		folders = append(folders, FolderEntry{
			Name: name,
			Path: filepath.Join(currentPath, name),
		})
	}

	return folders, nil
}

func pathWithinRoot(path string, root string) bool {
	if path == root {
		return true
	}

	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}

	if rel == "." {
		return true
	}

	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (s *GalleryService) GetConfig() config.AppConfig {
	return s.config.GetConfig()
}
func (s *GalleryService) AddFolder(path string, mode config.ScanMode) error {
	err := s.config.AddFolder(path, mode)
	if err != nil {
		return err
	}

	go s.indexer.ScanFolder(config.FolderConfig{Path: path, ScanMode: mode})
	return nil
}
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

func (s *GalleryService) OpenExternally(path string) error {
	cmd, err := buildOpenCommand(path)
	if err != nil {
		return err
	}

	return cmd.Start()
}

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

func (s *GalleryService) SetAutocompleteConfig(cfg config.AutocompleteConfig) error {
	return s.config.SetAutocompleteConfig(cfg)
}

func (s *GalleryService) SetPromptFormatConfig(cfg config.PromptFormatConfig) error {
	return s.config.SetPromptFormatConfig(cfg)
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

	time.Sleep(150 * time.Millisecond)
	go s.indexer.ScanAll()

	return nil
}

func (s *GalleryService) ListParserPlugins() ([]ParserPluginInfo, error) {
	if s.plugins == nil {
		return []ParserPluginInfo{}, nil
	}

	if err := s.plugins.Reload(); err != nil {
		return nil, err
	}

	return s.plugins.List(), nil
}

func (s *GalleryService) SetParserPluginEnabled(pluginID string, enabled bool) error {
	if s.plugins == nil {
		return nil
	}

	return s.plugins.SetEnabled(pluginID, enabled)
}

func (s *GalleryService) TrustParserPlugin(pluginID string) error {
	if s.plugins == nil {
		return nil
	}

	return s.plugins.Trust(pluginID, true)
}

func (s *GalleryService) UntrustParserPlugin(pluginID string) error {
	if s.plugins == nil {
		return nil
	}

	return s.plugins.Trust(pluginID, false)
}

func (s *GalleryService) InstallParserPlugin(zipPath string) (*ParserPluginInfo, error) {
	if s.plugins == nil {
		return nil, nil
	}

	return s.plugins.Install(zipPath)
}

func (s *GalleryService) RemoveParserPlugin(pluginID string) error {
	if s.plugins == nil {
		return nil
	}

	return s.plugins.Remove(pluginID)
}

func (s *GalleryService) RefetchImageMetadata(path string, mode string, pluginID string) (*db.ImageRecord, error) {
	refetchMode := MetadataRefetchMode(mode)
	if refetchMode != MetadataRefetchModePlugin {
		refetchMode = MetadataRefetchModeDefault
	}

	return s.indexer.RefetchMetadata(path, refetchMode, pluginID)
}

func (s *GalleryService) ListParserPluginLogs(pluginID string, limit int) []ParserPluginLogEntry {
	if s.plugins == nil {
		return []ParserPluginLogEntry{}
	}

	return s.plugins.ListLogs(pluginID, limit)
}

func (s *GalleryService) ClearParserPluginLogs() {
	if s.plugins == nil {
		return
	}

	s.plugins.ClearLogs()
}
