package services

import (
	"image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"

	"github.com/disintegration/imaging"
)

type ThumbnailService struct {
	cacheDir string
}

func NewThumbnailService() (*ThumbnailService, error) {
	dataDir, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}

	cacheDir := filepath.Join(dataDir, "pixora", "thumbs")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return nil, err
	}

	return &ThumbnailService{cacheDir: cacheDir}, nil
}

// Generate creates a thumbnail for the image and returns the path to the thumbnail
// Uses imaging to fit nicely within a bounding box
func (s *ThumbnailService) Generate(originalPath string, hash string) (string, error) {
	thumbPath := filepath.Join(s.cacheDir, hash+".jpg")

	// Check if already exists
	if _, err := os.Stat(thumbPath); err == nil {
		return thumbPath, nil
	}

	img, err := imaging.Open(originalPath, imaging.AutoOrientation(true))
	if err != nil {
		return "", err
	}

	// Keep aspect ratio but fit within 400x400
	thumb := imaging.Fit(img, 400, 400, imaging.Lanczos)

	f, err := os.Create(thumbPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	if err := jpeg.Encode(f, thumb, &jpeg.Options{Quality: 85}); err != nil {
		return "", err
	}

	return thumbPath, nil
}

// CacheDir returns the directory where thumbnails are stored
func (s *ThumbnailService) CacheDir() string {
	return s.cacheDir
}
