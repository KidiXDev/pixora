package parser

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
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

var pngHeader = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

// ParsePNGMetadata parses tEXt and iTXt chunks for A1111/ComfyUI metadata
func ParsePNGMetadata(path string) (*ImageMetadata, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	header := make([]byte, 8)
	if _, err := io.ReadFull(f, header); err != nil {
		return nil, err
	}
	if !bytes.Equal(header, pngHeader) {
		return nil, fmt.Errorf("not a png file")
	}

	metadata := &ImageMetadata{}
	var paramsStr string

	// Basic chunk parser
	for {
		var length uint32
		if err := binary.Read(f, binary.BigEndian, &length); err != nil {
			if err == io.EOF {
				break
			}
			return nil, err
		}

		chunkType := make([]byte, 4)
		if _, err := io.ReadFull(f, chunkType); err != nil {
			return nil, err
		}

		if string(chunkType) == "IEND" {
			break
		}

		if string(chunkType) == "tEXt" {
			data := make([]byte, length)
			if _, err := io.ReadFull(f, data); err != nil {
				return nil, err
			}
			parts := bytes.SplitN(data, []byte{0}, 2)
			if len(parts) == 2 {
				keyword := string(parts[0])
				text := string(parts[1])
				if keyword == "parameters" {
					paramsStr = text
				}
			}
		} else if string(chunkType) == "iTXt" {
			data := make([]byte, length)
			if _, err := io.ReadFull(f, data); err != nil {
				return nil, err
			}
			parts := bytes.SplitN(data, []byte{0}, 2)
			if len(parts) >= 2 {
				keyword := string(parts[0])
				if keyword == "parameters" {
					textStart := 0
					nullCount := 0
					for i := len(keyword) + 1; i < len(data); i++ {
						if data[i] == 0 {
							nullCount++
							if nullCount == 3 {
								textStart = i + 1
								break
							}
						}
					}
					if textStart > 0 && textStart < len(data) {
						paramsStr = string(data[textStart:])
					}
				}
			}
		} else {
			if _, err := f.Seek(int64(length), io.SeekCurrent); err != nil {
				return nil, err
			}
		}

		// Skip CRC
		if _, err := f.Seek(4, io.SeekCurrent); err != nil {
			return nil, err
		}
	}

	if paramsStr != "" {
		metadata.Raw = paramsStr
		parseA1111Parameters(paramsStr, metadata)
	}

	return metadata, nil
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
