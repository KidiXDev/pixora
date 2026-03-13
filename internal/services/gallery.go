package services

import (
	"context"
	"os/exec"
	"pixora/internal/config"
	"pixora/internal/db"
	"time"
)

type GalleryService struct {
	db      *db.DB
	config  *config.Manager
	indexer *Indexer
}

func NewGalleryService(database *db.DB, cfg *config.Manager, idx *Indexer) *GalleryService {
	return &GalleryService{
		db:      database,
		config:  cfg,
		indexer: idx,
	}
}

type PaginatedImages struct {
	Images     []db.ImageRecord `json:"images"`
	TotalCount int              `json:"totalCount"`
	Offset     int              `json:"offset"`
	Limit      int              `json:"limit"`
}

// GetImages returns a paginated list of images, optionally matching a search query and filtered by folder.
func (s *GalleryService) GetImages(query string, folderPath string, offset, limit int) (*PaginatedImages, error) {
	// Let's implement this in db.go next
	// This will use FTS5 if query is not empty
	images, total, err := s.db.SearchImages(context.Background(), query, folderPath, offset, limit)
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
	// Works on Windows
	cmd := exec.Command("cmd", "/c", "start", "", path)
	return cmd.Start()
}

// ShowInFolder opens the file explorer and selects the file
func (s *GalleryService) ShowInFolder(path string) error {
	// Works on Windows
	cmd := exec.Command("explorer", "/select,", path)
	return cmd.Start()
}

// SetTabs updates the tabs configuration.
func (s *GalleryService) SetTabs(tabs []config.TabConfig) error {
	return s.config.SetTabs(tabs)
}

// UpdateFolderAlias updates the alias for a supervised folder.
func (s *GalleryService) UpdateFolderAlias(path string, alias string) error {
	return s.config.UpdateFolderAlias(path, alias)
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
