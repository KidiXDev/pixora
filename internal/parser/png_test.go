package parser

import (
	"bytes"
	"compress/zlib"
	"testing"
)

func TestParseComfyPromptJSON(t *testing.T) {
	raw := `{
  "1": {
    "inputs": {
      "ckpt_name": "juggernaut.safetensors"
    },
    "class_type": "CheckpointLoaderSimple"
  },
  "2": {
    "inputs": {
      "text": "cinematic portrait of a fox",
      "clip": [
        "1",
        1
      ]
    },
    "class_type": "CLIPTextEncode"
  },
  "3": {
    "inputs": {
      "text": "lowres, blurry",
      "clip": [
        "1",
        1
      ]
    },
    "class_type": "CLIPTextEncode"
  },
  "4": {
    "inputs": {
      "seed": 123456789,
      "steps": 28,
      "cfg": 6.5,
      "sampler_name": "dpmpp_2m",
      "positive": [
        "2",
        0
      ],
      "negative": [
        "3",
        0
      ],
      "latent_image": [
        "5",
        0
      ]
    },
    "class_type": "KSampler"
  },
  "5": {
    "inputs": {
      "width": 1024,
      "height": 768,
      "batch_size": 1
    },
    "class_type": "EmptyLatentImage"
  }
}`

	m := &ImageMetadata{}
	parseComfyPromptJSON(raw, m)

	if m.Prompt != "cinematic portrait of a fox" {
		t.Fatalf("unexpected prompt: %q", m.Prompt)
	}
	if m.NegativePrompt != "lowres, blurry" {
		t.Fatalf("unexpected negative prompt: %q", m.NegativePrompt)
	}
	if m.Model != "juggernaut.safetensors" {
		t.Fatalf("unexpected model: %q", m.Model)
	}
	if m.Sampler != "dpmpp_2m" {
		t.Fatalf("unexpected sampler: %q", m.Sampler)
	}
	if m.Seed != "123456789" {
		t.Fatalf("unexpected seed: %q", m.Seed)
	}
	if m.CfgScale != 6.5 {
		t.Fatalf("unexpected cfg scale: %v", m.CfgScale)
	}
	if m.Width != 1024 || m.Height != 768 {
		t.Fatalf("unexpected size: %dx%d", m.Width, m.Height)
	}
}

func TestParseITXtChunkUncompressed(t *testing.T) {
	payload := []byte("parameters\x00\x00\x00\x00\x00hello world")
	key, text, err := parseITXtChunk(payload)
	if err != nil {
		t.Fatalf("parseITXtChunk returned error: %v", err)
	}
	if key != "parameters" {
		t.Fatalf("unexpected key: %q", key)
	}
	if text != "hello world" {
		t.Fatalf("unexpected text: %q", text)
	}
}

func TestParseITXtChunkCompressed(t *testing.T) {
	var compressed bytes.Buffer
	zw := zlib.NewWriter(&compressed)
	if _, err := zw.Write([]byte("{\"prompt\":\"hello\"}")); err != nil {
		t.Fatalf("failed writing compressed data: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("failed closing compressor: %v", err)
	}

	payload := append([]byte("prompt\x00\x01\x00\x00\x00"), compressed.Bytes()...)
	key, text, err := parseITXtChunk(payload)
	if err != nil {
		t.Fatalf("parseITXtChunk returned error: %v", err)
	}
	if key != "prompt" {
		t.Fatalf("unexpected key: %q", key)
	}
	if text != "{\"prompt\":\"hello\"}" {
		t.Fatalf("unexpected text: %q", text)
	}
}
