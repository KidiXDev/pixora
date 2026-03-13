package services

import (
	"context"
	"os/exec"
	"pixora/internal/config"
	"pixora/internal/db"
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

// GetImages returns a paginated list of images, optionally matching a search query.
func (s *GalleryService) GetImages(query string, offset, limit int) (*PaginatedImages, error) {
	// Let's implement this in db.go next
	// This will use FTS5 if query is not empty
	images, total, err := s.db.SearchImages(context.Background(), query, offset, limit)
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

	// Remove images associated with this folder from DB
	return s.db.RemoveImagesByFolder(context.Background(), path)
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
