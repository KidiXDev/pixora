# 🧩 Pixora Plugin Documentation

Pixora uses a flexible, secure JavaScript-based plugin system for parsing image metadata. This allows the community to add support for new AI tools (like Midjourney, ComfyUI, DALL-E, etc.) without modifying the core application.

---

## 📂 Plugin Structure

Every plugin must be contained within its own folder inside the `plugins/` directory.

```text
plugins/
└── my-parser-plugin/
    ├── manifest.json
    └── index.js
```

### 📄 `manifest.json`
The manifest file defines your plugin's identity and entry point.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Human-readable name |
| `version` | `string` | Semantic version of your plugin |
| `description` | `string` | Brief explanation of what it parses |
| `author` | `string` | Your name or organization |
| `main` | `string` | The relative path to your main JavaScript file |

**Example:**
```json
{
  "name": "ComfyUI Basic Parser",
  "version": "1.0.0",
  "description": "Extracts basic metadata from ComfyUI PNGs",
  "author": "Pixora",
  "main": "index.js"
}
```

---

## 💻 Plugin API

Your `main` file must use CommonJS-style exports (`module.exports`). It should export an object containing two primary functions: `detect` and `parse`.

```javascript
module.exports = {
  /**
   * Used to check if this image belongs to this parser.
   * Returns true if the plugin should handle this file.
   */
  detect(context) {
    // Check for specific keywords or file structure
    return context.textByKeyword && context.textByKeyword.comfy_workflow;
  },

  /**
   * Extracts and normalizes metadata from the image.
   * Returns a standardized Metadata object.
   */
  parse(context) {
    // Logic to extract fields from context
    return {
      prompt: "vibrant nebula, 4k",
      negativePrompt: "blur, low quality",
      model: "SDXL Turbo",
      sampler: "Euler a",
      seed: "123456789",
      cfgScale: 7.5,
      width: 1024,
      height: 1024,
      raw: context.raw // Keep original payload if needed
    };
  }
};
```

### 📥 The `context` Object
Both functions receive a `context` object containing pre-checked file information:

- `filePath` (string): Absolute path to the file.
- `extension` (string): File extension (e.g., ".png").
- `width` / `height` (number): Pixel dimensions.
- `raw` (string): The raw metadata payload from the file.
- `textByKeyword` (object): A map of text chunks (for PNGs, this maps keywords to text).
- `textEntries` (array): A flat list of all text items found in file chunks.

### 📤 The `Metadata` Object
The `parse` function should return an object with these fields (all optional):

- `prompt` (string)
- `negativePrompt` (string)
- `model` (string)
- `sampler` (string)
- `seed` (string)
- `cfgScale` (number)
- `width` (number)
- `height` (number)
- `raw` (string)

---

## 🛡️ Security & Constraints

To ensure system stability and user safety, plugins run in a highly restricted sandbox:

- **No OS Access**: You cannot access the filesystem, network, or environment variables.
- **No `require`**: All logic must be contained within your main file or combined before distribution.
- **Execution Limits**:
  - Max script size: **512 KB**.
  - Execution timeout: **200ms** per file.
- **Console Logging**: You can use `console.log()`, `console.warn()`, and `console.error()`. These will appear in the Pixora Plugin Console in Settings (Developer Mode).

---

## 🛠️ Development Tips

### Testing your Plugin
1. Enable **Developer Mode** in Settings.
2. Open the **Plugin Console** to see live output and errors.
3. Use `console.log(JSON.stringify(context))` in your `detect` function to inspect the available data for a specific file.

### Distribution
You can distribute your plugin as a `.zip` file. Pixora can install these directly via the **Install Plugin** button in Settings. Ensure the `manifest.json` is at the root of the zip or in the first subdirectory.

---

<p align="center">
  <em>Help the community! Share your parsers on the Pixora GitHub Discussions.</em>
</p>
