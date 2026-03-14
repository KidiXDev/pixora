package services

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"pixora/internal/parser"

	"github.com/dop251/goja"
)

const (
	pluginStatusEnabled   = "enabled"
	pluginStatusDisabled  = "disabled"
	pluginStatusError     = "error"
	pluginStatusUntrusted = "untrusted"

	maxPluginScriptSize = 512 * 1024
	pluginExecTimeout   = 200 * time.Millisecond
	maxPluginLogEntries = 500
)

var pluginIDSanitizer = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

type ParserPluginManifest struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	Author      string `json:"author"`
	Main        string `json:"main"`
}

type ParserPluginState struct {
	Trusted bool `json:"trusted"`
	Enabled bool `json:"enabled"`
}

type ParserPluginInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	Author      string `json:"author"`
	Main        string `json:"main"`
	FolderPath  string `json:"folderPath"`
	Status      string `json:"status"`
	Trusted     bool   `json:"trusted"`
	Enabled     bool   `json:"enabled"`
	Error       string `json:"error"`
}

type ParserPluginLogEntry struct {
	Timestamp string `json:"timestamp"`
	PluginID  string `json:"pluginID"`
	Level     string `json:"level"`
	Message   string `json:"message"`
}

type ParserPluginManager struct {
	pluginsDir string
	statePath  string

	mu      sync.RWMutex
	states  map[string]ParserPluginState
	plugins map[string]*loadedParserPlugin
	logs    []ParserPluginLogEntry
}

type loadedParserPlugin struct {
	manager   *ParserPluginManager
	info      ParserPluginInfo
	manifest  ParserPluginManifest
	script    string
	scriptRef string
}

type jsPluginMetadata struct {
	Prompt         string
	NegativePrompt string
	Model          string
	Sampler        string
	Seed           string
	CfgScale       float64
	Width          int
	Height         int
	Raw            string
}

func NewParserPluginManager(pluginsDir string) (*ParserPluginManager, error) {
	if pluginsDir == "" {
		pluginsDir = "plugins"
	}
	pluginsDir = filepath.Clean(pluginsDir)

	if err := os.MkdirAll(pluginsDir, 0755); err != nil {
		return nil, err
	}

	cfgDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	pixoraConfigDir := filepath.Join(cfgDir, "pixora")
	if err := os.MkdirAll(pixoraConfigDir, 0755); err != nil {
		return nil, err
	}

	mgr := &ParserPluginManager{
		pluginsDir: pluginsDir,
		statePath:  filepath.Join(pixoraConfigDir, "plugin_state.json"),
		states:     map[string]ParserPluginState{},
		plugins:    map[string]*loadedParserPlugin{},
		logs:       []ParserPluginLogEntry{},
	}

	if err := mgr.loadState(); err != nil {
		return nil, err
	}
	if err := mgr.Reload(); err != nil {
		return nil, err
	}

	return mgr, nil
}

func (m *ParserPluginManager) Reload() error {
	dirs, err := os.ReadDir(m.pluginsDir)
	if err != nil {
		return err
	}

	nextPlugins := map[string]*loadedParserPlugin{}
	changedState := false

	m.mu.Lock()
	defer m.mu.Unlock()

	for _, dir := range dirs {
		if !dir.IsDir() {
			continue
		}

		id := sanitizePluginID(dir.Name())
		if id == "" {
			continue
		}

		pluginPath := filepath.Join(m.pluginsDir, dir.Name())
		loaded := m.loadPlugin(id, pluginPath)
		nextPlugins[id] = loaded

		if _, ok := m.states[id]; !ok {
			m.states[id] = ParserPluginState{Trusted: false, Enabled: false}
			changedState = true
		}
	}

	for id := range m.states {
		if _, exists := nextPlugins[id]; !exists {
			delete(m.states, id)
			changedState = true
		}
	}

	m.plugins = nextPlugins
	m.applyStatesLocked()

	if changedState {
		if err := m.saveStateSnapshotLocked(); err != nil {
			return err
		}
	}

	return nil
}

func (m *ParserPluginManager) List() []ParserPluginInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	items := make([]ParserPluginInfo, 0, len(m.plugins))
	for _, plugin := range m.plugins {
		items = append(items, plugin.info)
	}

	sort.Slice(items, func(i, j int) bool {
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	return items
}

func (m *ParserPluginManager) SetEnabled(id string, enabled bool) error {
	id = sanitizePluginID(id)
	if id == "" {
		return errors.New("invalid plugin id")
	}

	m.mu.Lock()
	plugin, ok := m.plugins[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("plugin %q not found", id)
	}

	state := m.states[id]
	if enabled && !state.Trusted {
		m.mu.Unlock()
		return fmt.Errorf("plugin %q is untrusted", id)
	}

	state.Enabled = enabled
	m.states[id] = state
	m.applyStateToPluginLocked(plugin, state)
	err := m.saveStateSnapshotLocked()
	m.mu.Unlock()

	return err
}

func (m *ParserPluginManager) Trust(id string, trusted bool) error {
	id = sanitizePluginID(id)
	if id == "" {
		return errors.New("invalid plugin id")
	}

	m.mu.Lock()
	plugin, ok := m.plugins[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("plugin %q not found", id)
	}

	state := m.states[id]
	state.Trusted = trusted
	if !trusted {
		state.Enabled = false
	}
	m.states[id] = state
	m.applyStateToPluginLocked(plugin, state)
	err := m.saveStateSnapshotLocked()
	m.mu.Unlock()

	return err
}

func (m *ParserPluginManager) Remove(id string) error {
	id = sanitizePluginID(id)
	if id == "" {
		return errors.New("invalid plugin id")
	}

	if err := os.RemoveAll(filepath.Join(m.pluginsDir, id)); err != nil {
		return err
	}

	m.mu.Lock()
	delete(m.plugins, id)
	delete(m.states, id)
	err := m.saveStateSnapshotLocked()
	m.mu.Unlock()

	return err
}

func (m *ParserPluginManager) Install(zipPath string) (*ParserPluginInfo, error) {
	if strings.TrimSpace(zipPath) == "" {
		return nil, errors.New("zip path is required")
	}

	tempRoot, err := os.MkdirTemp("", "pixora-plugin-install-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tempRoot)

	if err := extractZipSecure(zipPath, tempRoot); err != nil {
		return nil, err
	}

	pluginRoot, manifest, err := discoverPluginRoot(tempRoot)
	if err != nil {
		return nil, err
	}

	pluginID := sanitizePluginID(filepath.Base(pluginRoot))
	if pluginID == "" {
		pluginID = sanitizePluginID(manifest.Name)
	}
	if pluginID == "" {
		return nil, errors.New("unable to derive plugin id")
	}

	targetDir := filepath.Join(m.pluginsDir, pluginID)
	if _, statErr := os.Stat(targetDir); statErr == nil {
		return nil, fmt.Errorf("plugin %q already exists", pluginID)
	}

	if err := copyDir(pluginRoot, targetDir); err != nil {
		return nil, err
	}

	if err := m.Reload(); err != nil {
		return nil, err
	}

	for _, info := range m.List() {
		if info.ID == pluginID {
			return &info, nil
		}
	}

	return nil, fmt.Errorf("plugin %q installed but not available", pluginID)
}

func (m *ParserPluginManager) ParsePNG(ctx *parser.PNGParseContext) (*parser.ImageMetadata, string, error) {
	if ctx == nil {
		return nil, "", nil
	}

	m.mu.RLock()
	plugins := make([]*loadedParserPlugin, 0, len(m.plugins))
	for _, p := range m.plugins {
		if p.info.Status == pluginStatusEnabled {
			plugins = append(plugins, p)
		}
	}
	m.mu.RUnlock()

	sort.Slice(plugins, func(i, j int) bool {
		return plugins[i].info.ID < plugins[j].info.ID
	})

	for _, plugin := range plugins {
		result, matched, err := plugin.run(ctx)
		if err != nil {
			log.Printf("[plugin:%s] parse error for %s: %v", plugin.info.ID, ctx.FilePath, err)
			m.appendLog(plugin.info.ID, "error", fmt.Sprintf("parse error for %s: %v", ctx.FilePath, err))
			m.setPluginError(plugin.info.ID, err)
			continue
		}
		if !matched || result == nil {
			continue
		}

		log.Printf("[plugin:%s] matched %s model=%q sampler=%q seed=%q", plugin.info.ID, ctx.FilePath, result.Model, result.Sampler, result.Seed)
		m.appendLog(plugin.info.ID, "info", fmt.Sprintf("matched %s model=%q sampler=%q seed=%q", ctx.FilePath, result.Model, result.Sampler, result.Seed))

		metadata := &parser.ImageMetadata{
			Prompt:         result.Prompt,
			NegativePrompt: result.NegativePrompt,
			Model:          result.Model,
			Sampler:        result.Sampler,
			Seed:           result.Seed,
			CfgScale:       result.CfgScale,
			Width:          result.Width,
			Height:         result.Height,
			Raw:            result.Raw,
		}

		return metadata, plugin.info.ID, nil
	}

	return nil, "", nil
}

func (m *ParserPluginManager) ParsePNGWithPlugin(ctx *parser.PNGParseContext, pluginID string) (*parser.ImageMetadata, error) {
	if ctx == nil {
		return nil, nil
	}

	pluginID = sanitizePluginID(pluginID)
	if pluginID == "" {
		return nil, errors.New("invalid plugin id")
	}

	m.mu.RLock()
	plugin, ok := m.plugins[pluginID]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("plugin %q not found", pluginID)
	}

	if plugin.info.Status != pluginStatusEnabled {
		return nil, fmt.Errorf("plugin %q is not enabled", pluginID)
	}

	result, matched, err := plugin.run(ctx)
	if err != nil {
		m.appendLog(pluginID, "error", fmt.Sprintf("parse error for %s: %v", ctx.FilePath, err))
		m.setPluginError(pluginID, err)
		return nil, err
	}
	if !matched || result == nil {
		m.appendLog(pluginID, "warn", fmt.Sprintf("plugin did not match metadata for %s", ctx.FilePath))
		return nil, nil
	}

	m.appendLog(pluginID, "info", fmt.Sprintf("matched %s model=%q sampler=%q seed=%q", ctx.FilePath, result.Model, result.Sampler, result.Seed))

	return &parser.ImageMetadata{
		Prompt:         result.Prompt,
		NegativePrompt: result.NegativePrompt,
		Model:          result.Model,
		Sampler:        result.Sampler,
		Seed:           result.Seed,
		CfgScale:       result.CfgScale,
		Width:          result.Width,
		Height:         result.Height,
		Raw:            result.Raw,
	}, nil
}

func (m *ParserPluginManager) ListLogs(pluginID string, limit int) []ParserPluginLogEntry {
	pluginID = sanitizePluginID(pluginID)

	m.mu.RLock()
	defer m.mu.RUnlock()

	if limit <= 0 {
		limit = 200
	}

	filtered := make([]ParserPluginLogEntry, 0, len(m.logs))
	for _, entry := range m.logs {
		if pluginID != "" && entry.PluginID != pluginID {
			continue
		}
		filtered = append(filtered, entry)
	}

	if len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}

	out := make([]ParserPluginLogEntry, len(filtered))
	copy(out, filtered)
	return out
}

func (m *ParserPluginManager) ClearLogs() {
	m.mu.Lock()
	m.logs = []ParserPluginLogEntry{}
	m.mu.Unlock()
}

func (m *ParserPluginManager) loadState() error {
	data, err := os.ReadFile(m.statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var decoded map[string]ParserPluginState
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}

	m.states = decoded
	if m.states == nil {
		m.states = map[string]ParserPluginState{}
	}

	return nil
}

func (m *ParserPluginManager) saveStateSnapshotLocked() error {
	snapshot := make(map[string]ParserPluginState, len(m.states))
	for key, value := range m.states {
		snapshot[key] = value
	}

	encoded, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(m.statePath, encoded, 0644)
}

func (m *ParserPluginManager) loadPlugin(id string, pluginPath string) *loadedParserPlugin {
	result := &loadedParserPlugin{
		manager: m,
		info: ParserPluginInfo{
			ID:         id,
			FolderPath: pluginPath,
		},
	}

	manifestPath := filepath.Join(pluginPath, "manifest.json")
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		result.info.Error = fmt.Sprintf("missing manifest.json: %v", err)
		return result
	}

	var manifest ParserPluginManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		result.info.Error = fmt.Sprintf("invalid manifest.json: %v", err)
		return result
	}

	manifest.Name = strings.TrimSpace(manifest.Name)
	manifest.Version = strings.TrimSpace(manifest.Version)
	manifest.Description = strings.TrimSpace(manifest.Description)
	manifest.Author = strings.TrimSpace(manifest.Author)
	manifest.Main = strings.TrimSpace(manifest.Main)

	if manifest.Name == "" || manifest.Main == "" {
		result.info.Error = "manifest must include non-empty name and main"
		return result
	}

	if filepath.IsAbs(manifest.Main) || strings.Contains(manifest.Main, "..") {
		result.info.Error = "manifest main must be a safe relative path"
		return result
	}

	mainPath := filepath.Join(pluginPath, manifest.Main)
	scriptBytes, err := os.ReadFile(mainPath)
	if err != nil {
		result.info.Error = fmt.Sprintf("failed to read main file: %v", err)
		return result
	}
	if len(scriptBytes) > maxPluginScriptSize {
		result.info.Error = fmt.Sprintf("plugin script too large (max %d bytes)", maxPluginScriptSize)
		return result
	}

	script := string(scriptBytes)
	if _, err := goja.Compile(mainPath, script, false); err != nil {
		result.info.Error = fmt.Sprintf("javascript compile error: %v", err)
		return result
	}

	result.manifest = manifest
	result.script = script
	result.scriptRef = mainPath
	result.info.Name = manifest.Name
	result.info.Version = manifest.Version
	result.info.Description = manifest.Description
	result.info.Author = manifest.Author
	result.info.Main = manifest.Main

	return result
}

func (m *ParserPluginManager) applyStatesLocked() {
	for id, plugin := range m.plugins {
		state := m.states[id]
		m.applyStateToPluginLocked(plugin, state)
	}
}

func (m *ParserPluginManager) applyStateToPluginLocked(plugin *loadedParserPlugin, state ParserPluginState) {
	plugin.info.Trusted = state.Trusted
	plugin.info.Enabled = state.Enabled

	if plugin.info.Error != "" {
		plugin.info.Status = pluginStatusError
		return
	}

	if !state.Trusted {
		plugin.info.Status = pluginStatusUntrusted
		return
	}

	if !state.Enabled {
		plugin.info.Status = pluginStatusDisabled
		return
	}

	plugin.info.Status = pluginStatusEnabled
}

func (m *ParserPluginManager) setPluginError(id string, err error) {
	if err == nil {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	plugin, ok := m.plugins[id]
	if !ok {
		return
	}

	plugin.info.Error = err.Error()
	plugin.info.Status = pluginStatusError
}

func (p *loadedParserPlugin) run(ctx *parser.PNGParseContext) (*jsPluginMetadata, bool, error) {
	runtime, moduleExports, err := p.evalModule()
	if err != nil {
		return nil, false, err
	}

	pluginObj, ok := moduleExports.(*goja.Object)
	if !ok {
		return nil, false, errors.New("plugin must export an object")
	}

	ctxValue := runtime.ToValue(map[string]any{
		"filePath":      ctx.FilePath,
		"extension":     ctx.Extension,
		"width":         ctx.Width,
		"height":        ctx.Height,
		"raw":           ctx.Raw,
		"textByKeyword": ctx.TextByKeyword,
		"textEntries":   ctx.TextEntries,
	})

	detectValue := pluginObj.Get("detect")
	detectFn, ok := goja.AssertFunction(detectValue)
	if !ok {
		return nil, false, errors.New("plugin must export detect(context)")
	}

	detectResult, err := callWithTimeout(runtime, func() (goja.Value, error) {
		return detectFn(pluginObj, ctxValue)
	})
	if err != nil {
		return nil, false, fmt.Errorf("detect failed: %w", err)
	}

	if !detectResult.ToBoolean() {
		return nil, false, nil
	}

	parseValue := pluginObj.Get("parse")
	parseFn, ok := goja.AssertFunction(parseValue)
	if !ok {
		return nil, false, errors.New("plugin must export parse(context)")
	}

	parseResult, err := callWithTimeout(runtime, func() (goja.Value, error) {
		return parseFn(pluginObj, ctxValue)
	})
	if err != nil {
		return nil, false, fmt.Errorf("parse failed: %w", err)
	}

	if goja.IsNull(parseResult) || goja.IsUndefined(parseResult) {
		return nil, true, nil
	}

	output, err := decodePluginMetadata(runtime, parseResult)
	if err != nil {
		return nil, false, fmt.Errorf("parse returned invalid data: %w", err)
	}

	return output, true, nil
}

func (p *loadedParserPlugin) evalModule() (*goja.Runtime, goja.Value, error) {
	runtime := goja.New()

	moduleObj := runtime.NewObject()
	exportsObj := runtime.NewObject()
	if err := moduleObj.Set("exports", exportsObj); err != nil {
		return nil, nil, err
	}
	if err := runtime.Set("module", moduleObj); err != nil {
		return nil, nil, err
	}
	if err := runtime.Set("exports", exportsObj); err != nil {
		return nil, nil, err
	}
	if err := runtime.Set("console", map[string]func(...any){
		"log": func(args ...any) {
			log.Printf("[plugin:%s] %s", p.info.ID, joinConsoleArgs(args))
			if p.manager != nil {
				p.manager.appendLog(p.info.ID, "info", joinConsoleArgs(args))
			}
		},
		"warn": func(args ...any) {
			log.Printf("[plugin:%s][warn] %s", p.info.ID, joinConsoleArgs(args))
			if p.manager != nil {
				p.manager.appendLog(p.info.ID, "warn", joinConsoleArgs(args))
			}
		},
		"error": func(args ...any) {
			log.Printf("[plugin:%s][error] %s", p.info.ID, joinConsoleArgs(args))
			if p.manager != nil {
				p.manager.appendLog(p.info.ID, "error", joinConsoleArgs(args))
			}
		},
	}); err != nil {
		return nil, nil, err
	}

	_, err := callWithTimeout(runtime, func() (goja.Value, error) {
		return runtime.RunScript(p.scriptRef, p.script)
	})
	if err != nil {
		return nil, nil, err
	}

	return runtime, moduleObj.Get("exports"), nil
}

func callWithTimeout(runtime *goja.Runtime, fn func() (goja.Value, error)) (goja.Value, error) {
	timer := time.AfterFunc(pluginExecTimeout, func() {
		runtime.Interrupt("plugin execution timed out")
	})
	defer timer.Stop()

	defer runtime.ClearInterrupt()

	var (
		result goja.Value
		err    error
	)

	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				err = fmt.Errorf("%v", recovered)
			}
		}()
		result, err = fn()
	}()

	if err != nil {
		return nil, err
	}

	return result, nil
}

func discoverPluginRoot(root string) (string, ParserPluginManifest, error) {
	manifestPath := ""
	var manifest ParserPluginManifest

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		if strings.EqualFold(filepath.Base(path), "manifest.json") {
			if manifestPath != "" {
				return errors.New("zip contains multiple manifest.json files")
			}
			manifestPath = path
		}
		return nil
	})
	if err != nil {
		return "", ParserPluginManifest{}, err
	}

	if manifestPath == "" {
		return "", ParserPluginManifest{}, errors.New("zip does not contain manifest.json")
	}

	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", ParserPluginManifest{}, err
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return "", ParserPluginManifest{}, fmt.Errorf("invalid manifest.json: %w", err)
	}

	return filepath.Dir(manifestPath), manifest, nil
}

func extractZipSecure(zipPath string, dest string) error {
	archive, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer archive.Close()

	for _, file := range archive.File {
		cleanName := filepath.Clean(file.Name)
		if strings.HasPrefix(cleanName, "..") || filepath.IsAbs(cleanName) {
			return fmt.Errorf("invalid entry path %q", file.Name)
		}

		targetPath := filepath.Join(dest, cleanName)
		if !strings.HasPrefix(targetPath, dest+string(os.PathSeparator)) && targetPath != dest {
			return fmt.Errorf("invalid entry path %q", file.Name)
		}

		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(targetPath, 0755); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			return err
		}

		src, err := file.Open()
		if err != nil {
			return err
		}

		dst, err := os.Create(targetPath)
		if err != nil {
			src.Close()
			return err
		}

		if _, err := io.Copy(dst, src); err != nil {
			dst.Close()
			src.Close()
			return err
		}

		dst.Close()
		src.Close()
	}

	return nil
}

func copyDir(src string, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)

		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}

		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}

		srcFile, err := os.Open(path)
		if err != nil {
			return err
		}
		defer srcFile.Close()

		dstFile, err := os.Create(target)
		if err != nil {
			return err
		}
		defer dstFile.Close()

		_, err = io.Copy(dstFile, srcFile)
		return err
	})
}

func sanitizePluginID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	clean := pluginIDSanitizer.ReplaceAllString(raw, "-")
	clean = strings.Trim(clean, "-.")
	return strings.ToLower(clean)
}

func joinConsoleArgs(args []any) string {
	if len(args) == 0 {
		return ""
	}

	parts := make([]string, 0, len(args))
	for _, arg := range args {
		if arg == nil {
			parts = append(parts, "null")
			continue
		}
		parts = append(parts, fmt.Sprintf("%v", arg))
	}

	return strings.Join(parts, " ")
}

func decodePluginMetadata(runtime *goja.Runtime, value goja.Value) (*jsPluginMetadata, error) {
	obj := value.ToObject(runtime)
	if obj == nil {
		return nil, errors.New("parse() must return an object")
	}

	getString := func(keys ...string) string {
		for _, key := range keys {
			v := obj.Get(key)
			if goja.IsUndefined(v) || goja.IsNull(v) {
				continue
			}
			s := strings.TrimSpace(v.String())
			if s != "" {
				return s
			}
		}
		return ""
	}

	getFloat := func(keys ...string) float64 {
		for _, key := range keys {
			v := obj.Get(key)
			if goja.IsUndefined(v) || goja.IsNull(v) {
				continue
			}

			var n float64
			if err := runtime.ExportTo(v, &n); err == nil {
				if !isNaNOrInf(n) {
					return n
				}
			}

			s := strings.TrimSpace(v.String())
			if s == "" {
				continue
			}
			if parsed, err := strconv.ParseFloat(s, 64); err == nil && !isNaNOrInf(parsed) {
				return parsed
			}
		}
		return 0
	}

	getInt := func(keys ...string) int {
		for _, key := range keys {
			v := obj.Get(key)
			if goja.IsUndefined(v) || goja.IsNull(v) {
				continue
			}

			var n float64
			if err := runtime.ExportTo(v, &n); err == nil {
				if !isNaNOrInf(n) {
					return int(n)
				}
			}

			s := strings.TrimSpace(v.String())
			if s == "" {
				continue
			}
			if parsed, err := strconv.Atoi(s); err == nil {
				return parsed
			}
		}
		return 0
	}

	decoded := &jsPluginMetadata{
		Prompt:         getString("prompt", "Prompt"),
		NegativePrompt: getString("negativePrompt", "negative_prompt", "NegativePrompt", "Negative_Prompt"),
		Model:          getString("model", "Model"),
		Sampler:        getString("sampler", "Sampler"),
		Seed:           getString("seed", "Seed"),
		CfgScale:       getFloat("cfgScale", "cfg", "CfgScale", "CFGScale"),
		Width:          getInt("width", "Width"),
		Height:         getInt("height", "Height"),
		Raw:            getString("raw", "Raw"),
	}

	return decoded, nil
}

func isNaNOrInf(v float64) bool {
	return math.IsNaN(v) || math.IsInf(v, 0)
}

func (m *ParserPluginManager) appendLog(pluginID string, level string, message string) {
	entry := ParserPluginLogEntry{
		Timestamp: time.Now().Format(time.RFC3339),
		PluginID:  sanitizePluginID(pluginID),
		Level:     strings.TrimSpace(strings.ToLower(level)),
		Message:   strings.TrimSpace(message),
	}

	if entry.PluginID == "" || entry.Message == "" {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.logs = append(m.logs, entry)
	if len(m.logs) > maxPluginLogEntries {
		m.logs = m.logs[len(m.logs)-maxPluginLogEntries:]
	}
}
