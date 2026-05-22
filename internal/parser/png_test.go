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
      "steps": 20,
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

func TestParseComfyPromptJSONSupportsDiffusionModelLoaderAndSamplerSelect(t *testing.T) {
	raw := `{
  "1": {
    "inputs": {
      "unet_name": "flux1-dev.safetensors"
    },
    "class_type": "UNetLoader"
  },
  "2": {
    "inputs": {
      "text": "city skyline at sunset",
      "clip": [
        "1",
        0
      ]
    },
    "class_type": "CLIPTextEncode"
  },
  "3": {
    "inputs": {
      "text": "blurry, low quality",
      "clip": [
        "1",
        0
      ]
    },
    "class_type": "CLIPTextEncode"
  },
  "4": {
    "inputs": {
      "sampler_name": "dpmpp_2m_sde"
    },
    "class_type": "KSamplerSelect"
  },
  "5": {
    "inputs": {
      "seed": 42,
      "cfg": 3.5,
      "sampler": [
        "4",
        0
      ],
      "positive": [
        "2",
        0
      ],
      "negative": [
        "3",
        0
      ],
      "latent_image": [
        "6",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced"
  },
  "6": {
    "inputs": {
      "width": 1360,
      "height": 768,
      "batch_size": 1
    },
    "class_type": "EmptySD3LatentImage"
  }
}`

	m := &ImageMetadata{}
	parseComfyPromptJSON(raw, m)

	if m.Model != "flux1-dev.safetensors" {
		t.Fatalf("unexpected model: %q", m.Model)
	}
	if m.Sampler != "dpmpp_2m_sde" {
		t.Fatalf("unexpected sampler: %q", m.Sampler)
	}
	if m.Seed != "42" {
		t.Fatalf("unexpected seed: %q", m.Seed)
	}
	if m.CfgScale != 3.5 {
		t.Fatalf("unexpected cfg scale: %v", m.CfgScale)
	}
	if m.Prompt != "city skyline at sunset" {
		t.Fatalf("unexpected prompt: %q", m.Prompt)
	}
	if m.NegativePrompt != "blurry, low quality" {
		t.Fatalf("unexpected negative prompt: %q", m.NegativePrompt)
	}
	if m.Width != 1360 || m.Height != 768 {
		t.Fatalf("unexpected size: %dx%d", m.Width, m.Height)
	}
}

func TestParseComfyPromptJSONSupportsYEPromptChain(t *testing.T) {
	raw := `{
  "1": {
    "inputs": {
      "prompt": "high detail mecha city"
    },
    "class_type": "YEPrompt"
  },
  "2": {
    "inputs": {
      "prompt": "lowres, blurry"
    },
    "class_type": "YEPrompt"
  },
  "3": {
    "inputs": {
      "clip": [
        "6",
        1
      ],
      "prompt": [
        "1",
        0
      ],
      "format_prompt": true
    },
    "class_type": "YEClipTextEncodePrompt"
  },
  "4": {
    "inputs": {
      "clip": [
        "6",
        1
      ],
      "prompt": [
        "2",
        0
      ],
      "format_prompt": true
    },
    "class_type": "YEClipTextEncodePrompt"
  },
  "5": {
    "inputs": {
      "seed": 987654321,
      "steps": 20,
      "cfg": 7,
      "sampler_name": "euler_ancestral",
      "positive": [
        "3",
        0
      ],
      "negative": [
        "4",
        0
      ],
      "latent_image": [
        "7",
        0
      ]
    },
    "class_type": "YEKSampler"
  },
  "6": {
    "inputs": {
      "ckpt_name": "sdxl.safetensors"
    },
    "class_type": "YELoadCheckpoint"
  },
  "7": {
    "inputs": {
      "width": 1024,
      "height": 1024,
      "batch_size": 1
    },
    "class_type": "YEEmptyLatentImage"
  }
}`

	m := &ImageMetadata{}
	parseComfyPromptJSON(raw, m)

	if m.Prompt != "high detail mecha city" {
		t.Fatalf("unexpected prompt: %q", m.Prompt)
	}
	if m.NegativePrompt != "lowres, blurry" {
		t.Fatalf("unexpected negative prompt: %q", m.NegativePrompt)
	}
	if m.Model != "sdxl.safetensors" {
		t.Fatalf("unexpected model: %q", m.Model)
	}
	if m.Sampler != "euler_ancestral" {
		t.Fatalf("unexpected sampler: %q", m.Sampler)
	}
	if m.Seed != "987654321" {
		t.Fatalf("unexpected seed: %q", m.Seed)
	}
	if m.CfgScale != 7 {
		t.Fatalf("unexpected cfg scale: %v", m.CfgScale)
	}
	if m.Width != 1024 || m.Height != 1024 {
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
