package parser

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

// ImageMetadata holds A1111/ComfyUI Metadata extracted from PNG
type ImageMetadata struct {
	Prompt         string
	NegativePrompt string
	Model          string
	Sampler        string
	Seed           string
	CfgScale       float64
	Width          int
	Height         int
	Raw            string // Raw parameter string or Workflow JSON
}

type MetadataTextEntry struct {
	Keyword   string `json:"keyword"`
	Text      string `json:"text"`
	ChunkType string `json:"chunkType"`
}

type PNGParseContext struct {
	FilePath      string              `json:"filePath"`
	Extension     string              `json:"extension"`
	Width         int                 `json:"width"`
	Height        int                 `json:"height"`
	Raw           string              `json:"raw"`
	TextByKeyword map[string]string   `json:"textByKeyword"`
	TextEntries   []MetadataTextEntry `json:"textEntries"`
}

var pngHeader = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

// ParsePNGMetadata parses tEXt and iTXt chunks for A1111/ComfyUI metadata
func ParsePNGMetadata(path string) (*ImageMetadata, error) {
	metadata, _, err := ParsePNGMetadataWithContext(path)
	if err != nil {
		return nil, err
	}

	return metadata, nil
}

// ParsePNGMetadataWithContext parses tEXt and iTXt chunks for A1111/ComfyUI metadata
// and returns a context object that can be used by parser plugins.
func ParsePNGMetadataWithContext(path string) (*ImageMetadata, *PNGParseContext, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()

	header := make([]byte, 8)
	if _, err := io.ReadFull(f, header); err != nil {
		return nil, nil, err
	}
	if !bytes.Equal(header, pngHeader) {
		return nil, nil, fmt.Errorf("not a png file")
	}

	metadata := &ImageMetadata{}
	ctx := &PNGParseContext{
		FilePath:      path,
		Extension:     ".png",
		TextByKeyword: map[string]string{},
		TextEntries:   []MetadataTextEntry{},
	}
	var paramsStr string
	var promptJSON string
	var workflowJSON string
	haveSize := false
	haveParams := false

	// Basic chunk parser
	for {
		var length uint32
		if err := binary.Read(f, binary.BigEndian, &length); err != nil {
			if err == io.EOF {
				break
			}
			return nil, nil, err
		}

		chunkType := make([]byte, 4)
		if _, err := io.ReadFull(f, chunkType); err != nil {
			return nil, nil, err
		}

		if string(chunkType) == "IEND" {
			break
		}

		if string(chunkType) == "IHDR" {
			data := make([]byte, length)
			if _, err := io.ReadFull(f, data); err != nil {
				return nil, nil, err
			}
			if len(data) >= 8 {
				metadata.Width = int(binary.BigEndian.Uint32(data[0:4]))
				metadata.Height = int(binary.BigEndian.Uint32(data[4:8]))
				ctx.Width = metadata.Width
				ctx.Height = metadata.Height
				haveSize = true
			}
		} else if string(chunkType) == "tEXt" {
			data := make([]byte, length)
			if _, err := io.ReadFull(f, data); err != nil {
				return nil, nil, err
			}
			parts := bytes.SplitN(data, []byte{0}, 2)
			if len(parts) == 2 {
				keyword := string(parts[0])
				text := string(parts[1])
				ctx.TextEntries = append(ctx.TextEntries, MetadataTextEntry{Keyword: keyword, Text: text, ChunkType: "tEXt"})
				if _, exists := ctx.TextByKeyword[keyword]; !exists {
					ctx.TextByKeyword[keyword] = text
				}
				switch keyword {
				case "parameters":
					paramsStr = text
					haveParams = true
				case "prompt":
					promptJSON = text
					parseComfyPromptJSON(promptJSON, metadata)
				case "workflow":
					workflowJSON = text
				}
			}
		} else if string(chunkType) == "iTXt" {
			data := make([]byte, length)
			if _, err := io.ReadFull(f, data); err != nil {
				return nil, nil, err
			}
			keyword, text, err := parseITXtChunk(data)
			if err == nil {
				ctx.TextEntries = append(ctx.TextEntries, MetadataTextEntry{Keyword: keyword, Text: text, ChunkType: "iTXt"})
				if _, exists := ctx.TextByKeyword[keyword]; !exists {
					ctx.TextByKeyword[keyword] = text
				}
				switch keyword {
				case "parameters":
					paramsStr = text
					haveParams = true
				case "prompt":
					promptJSON = text
					parseComfyPromptJSON(promptJSON, metadata)
				case "workflow":
					workflowJSON = text
				}
			}
		} else {
			if _, err := f.Seek(int64(length), io.SeekCurrent); err != nil {
				return nil, nil, err
			}
		}

		// Skip CRC
		if _, err := f.Seek(4, io.SeekCurrent); err != nil {
			return nil, nil, err
		}

		if haveSize && haveParams {
			break
		}
	}

	if paramsStr != "" {
		metadata.Raw = paramsStr
		parseA1111Parameters(paramsStr, metadata)
	} else {
		if promptJSON != "" {
			metadata.Raw = promptJSON
		}
		if metadata.Raw == "" && workflowJSON != "" {
			metadata.Raw = workflowJSON
		}
	}
	ctx.Raw = metadata.Raw
	ctx.Width = metadata.Width
	ctx.Height = metadata.Height

	return metadata, ctx, nil
}

func parseITXtChunk(data []byte) (string, string, error) {
	i := bytes.IndexByte(data, 0)
	if i <= 0 {
		return "", "", fmt.Errorf("invalid iTXt chunk: missing keyword")
	}

	keyword := string(data[:i])
	pos := i + 1
	if pos+2 > len(data) {
		return "", "", fmt.Errorf("invalid iTXt chunk: truncated compression fields")
	}

	compressionFlag := data[pos]
	compressionMethod := data[pos+1]
	_ = compressionMethod
	pos += 2

	langEnd := bytes.IndexByte(data[pos:], 0)
	if langEnd < 0 {
		return "", "", fmt.Errorf("invalid iTXt chunk: missing language terminator")
	}
	pos += langEnd + 1

	translatedEnd := bytes.IndexByte(data[pos:], 0)
	if translatedEnd < 0 {
		return "", "", fmt.Errorf("invalid iTXt chunk: missing translated keyword terminator")
	}
	pos += translatedEnd + 1

	if pos > len(data) {
		return "", "", fmt.Errorf("invalid iTXt chunk: missing text")
	}

	textData := data[pos:]
	if compressionFlag == 1 {
		zr, err := zlib.NewReader(bytes.NewReader(textData))
		if err != nil {
			return "", "", err
		}
		defer zr.Close()

		decoded, err := io.ReadAll(zr)
		if err != nil {
			return "", "", err
		}
		return keyword, string(decoded), nil
	}

	return keyword, string(textData), nil
}

func parseComfyPromptJSON(raw string, metadata *ImageMetadata) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || !strings.HasPrefix(trimmed, "{") {
		return
	}

	var root map[string]any
	if err := json.Unmarshal([]byte(trimmed), &root); err != nil {
		return
	}

	nodes := root
	if promptNode, ok := root["prompt"]; ok {
		if promptMap, ok := asMap(promptNode); ok {
			nodes = promptMap
		}
	}

	clipTexts := make(map[string]string)
	nodeInputs := make(map[string]map[string]any)
	positiveRef := ""
	negativeRef := ""
	latentRef := ""

	for nodeID, nodeVal := range nodes {
		nodeMap, ok := asMap(nodeVal)
		if !ok {
			continue
		}
		inputs, _ := asMap(nodeMap["inputs"])
		nodeInputs[nodeID] = inputs

		classType := asString(nodeMap["class_type"])
		switch classType {
		case "CLIPTextEncode":
			if text := asString(inputs["text"]); text != "" {
				clipTexts[nodeID] = text
			}
		case "CheckpointLoaderSimple":
			if metadata.Model == "" {
				metadata.Model = asString(inputs["ckpt_name"])
			}
		case "KSampler", "KSamplerAdvanced":
			if metadata.Sampler == "" {
				if sampler := asString(inputs["sampler_name"]); sampler != "" {
					metadata.Sampler = sampler
				} else {
					metadata.Sampler = asString(inputs["sampler"])
				}
			}
			if metadata.Seed == "" {
				if seed, ok := asInt64String(inputs["seed"]); ok {
					metadata.Seed = seed
				}
			}
			if metadata.CfgScale == 0 {
				if cfg, ok := asFloat64(inputs["cfg"]); ok {
					metadata.CfgScale = cfg
				}
			}
			if positiveRef == "" {
				positiveRef = extractNodeRefID(inputs["positive"])
			}
			if negativeRef == "" {
				negativeRef = extractNodeRefID(inputs["negative"])
			}
			if latentRef == "" {
				latentRef = extractNodeRefID(inputs["latent_image"])
			}
		case "EmptyLatentImage":
			if metadata.Width == 0 {
				if width, ok := asInt(inputs["width"]); ok {
					metadata.Width = width
				}
			}
			if metadata.Height == 0 {
				if height, ok := asInt(inputs["height"]); ok {
					metadata.Height = height
				}
			}
		}
	}

	if metadata.Prompt == "" && positiveRef != "" {
		metadata.Prompt = strings.TrimSpace(clipTexts[positiveRef])
	}
	if metadata.NegativePrompt == "" && negativeRef != "" {
		metadata.NegativePrompt = strings.TrimSpace(clipTexts[negativeRef])
	}

	if (metadata.Width == 0 || metadata.Height == 0) && latentRef != "" {
		if latentInputs, ok := nodeInputs[latentRef]; ok {
			if metadata.Width == 0 {
				if width, ok := asInt(latentInputs["width"]); ok {
					metadata.Width = width
				}
			}
			if metadata.Height == 0 {
				if height, ok := asInt(latentInputs["height"]); ok {
					metadata.Height = height
				}
			}
		}
	}
}

func asMap(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func asString(v any) string {
	s, ok := v.(string)
	if ok {
		return s
	}
	return ""
}

func asFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	default:
		return 0, false
	}
}

func asInt(v any) (int, bool) {
	f, ok := asFloat64(v)
	if !ok {
		return 0, false
	}
	return int(f), true
}

func asInt64String(v any) (string, bool) {
	switch n := v.(type) {
	case int:
		return strconv.Itoa(n), true
	case int64:
		return strconv.FormatInt(n, 10), true
	case float64:
		return strconv.FormatInt(int64(n), 10), true
	case json.Number:
		i, err := n.Int64()
		if err != nil {
			f, ferr := n.Float64()
			if ferr != nil {
				return "", false
			}
			return strconv.FormatInt(int64(f), 10), true
		}
		return strconv.FormatInt(i, 10), true
	case string:
		return strings.TrimSpace(n), strings.TrimSpace(n) != ""
	default:
		return "", false
	}
}

func extractNodeRefID(v any) string {
	arr, ok := v.([]any)
	if !ok || len(arr) == 0 {
		return ""
	}

	switch id := arr[0].(type) {
	case string:
		return id
	case float64:
		return strconv.FormatInt(int64(id), 10)
	case int:
		return strconv.Itoa(id)
	case int64:
		return strconv.FormatInt(id, 10)
	default:
		return ""
	}
}

func parseA1111Parameters(params string, metadata *ImageMetadata) {
	lines := strings.Split(params, "\n")
	if len(lines) == 0 {
		return
	}

	// The last line usually contains keys like "Steps: 20, Sampler: Euler a, CFG scale: 7..."
	lastLine := strings.TrimSpace(lines[len(lines)-1])
	if strings.HasPrefix(lastLine, "Steps:") {
		parseKeyValuePairs(lastLine, metadata)
		lines = lines[:len(lines)-1]
	}

	var promptLines []string
	var negativePromptLines []string
	inNegative := false

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Negative prompt:") {
			inNegative = true
			negativePromptLines = append(negativePromptLines, strings.TrimPrefix(line, "Negative prompt: "))
		} else if inNegative {
			negativePromptLines = append(negativePromptLines, line)
		} else {
			promptLines = append(promptLines, line)
		}
	}

	metadata.Prompt = strings.TrimSpace(strings.Join(promptLines, "\n"))
	metadata.NegativePrompt = strings.TrimSpace(strings.Join(negativePromptLines, "\n"))
}

func parseKeyValuePairs(line string, metadata *ImageMetadata) {
	parts := strings.Split(line, ", ")
	for _, part := range parts {
		kv := strings.SplitN(part, ": ", 2)
		if len(kv) != 2 {
			continue
		}
		key, val := strings.TrimSpace(kv[0]), strings.TrimSpace(kv[1])
		switch key {
		case "Model":
			metadata.Model = val
		case "Sampler":
			metadata.Sampler = val
		case "Seed":
			metadata.Seed = val
		case "CFG scale":
			fmt.Sscanf(val, "%f", &metadata.CfgScale)
		case "Size":
			fmt.Sscanf(val, "%dx%d", &metadata.Width, &metadata.Height)
		}
	}
}
