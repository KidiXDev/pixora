package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type ScanMode string

const (
	ScanModeNormal ScanMode = "normal"
	ScanModeWalk   ScanMode = "walk"
)

type FolderConfig struct {
	Path     string   `json:"path"`
	ScanMode ScanMode `json:"scanMode"`
	Alias    string   `json:"alias"`
}

type TabConfig struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Path   string `json:"path"` // empty means all
	IsWalk bool   `json:"isWalk"`
}

type AppConfig struct {
	Folders []FolderConfig `json:"folders"`
	Tabs    []TabConfig    `json:"tabs"` 
}

type Manager struct {
	configPath string
	config     AppConfig
	mu         sync.RWMutex
}

func NewManager() (*Manager, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}

	pixoraDir := filepath.Join(configDir, "pixora")
	if err := os.MkdirAll(pixoraDir, 0755); err != nil {
		return nil, err
	}

	configPath := filepath.Join(pixoraDir, "config.json")
	m := &Manager{
		configPath: configPath,
		config: AppConfig{
			Folders: []FolderConfig{},
			Tabs:    []TabConfig{},
		},
	}

	if err := m.Load(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	return m, nil
}

func (m *Manager) Load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := os.ReadFile(m.configPath)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, &m.config)
}

func (m *Manager) Save() error {
	m.mu.RLock()
	defer m.mu.RUnlock()

	data, err := json.MarshalIndent(m.config, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(m.configPath, data, 0644)
}

func (m *Manager) GetConfig() AppConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.config
}

func (m *Manager) AddFolder(path string, mode ScanMode) error {
	m.mu.Lock()
	// Check if already exists
	exists := false
	for i, f := range m.config.Folders {
		if f.Path == path {
			m.config.Folders[i].ScanMode = mode // update mode
			exists = true
			break
		}
	}
	if !exists {
		m.config.Folders = append(m.config.Folders, FolderConfig{Path: path, ScanMode: mode})
	}
	m.mu.Unlock()

	return m.Save()
}

func (m *Manager) RemoveFolder(path string) error {
	m.mu.Lock()
	var newFolders []FolderConfig
	for _, f := range m.config.Folders {
		if f.Path != path {
			newFolders = append(newFolders, f)
		}
	}
	m.config.Folders = newFolders
	m.mu.Unlock()

	return m.Save()
}

func (m *Manager) SetTabs(tabs []TabConfig) error {
	m.mu.Lock()
	m.config.Tabs = tabs
	m.mu.Unlock()
	return m.Save()
}

func (m *Manager) UpdateFolderAlias(path string, alias string) error {
	m.mu.Lock()
	for i, f := range m.config.Folders {
		if f.Path == path {
			m.config.Folders[i].Alias = alias
			break
		}
	}
	m.mu.Unlock()
	return m.Save()
}

