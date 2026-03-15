# Example Plugin: Basic JSON Parser

This example demonstrates how to create a simple Pixora plugin that parses a custom JSON string from an image's metadata. It also shows how to handle Base64-encoded metadata payloads with the built-in helper.

## Overview

We will build a plugin called **"Simple JSON Meta"**. It will look for a keyword named `UserComment` (common in JPEGs/PNGs), decode it if needed, and parse it as JSON to extract a prompt and seed.

## File Structure

Create a folder inside your `plugins/` directory:

```text
plugins/
  simple-json-meta/
    manifest.json
    index.js
```

---

## 1. The Manifest (`manifest.json`)

The manifest tells Pixora who you are and which file to run.

```json
{
  "name": "Simple JSON Meta",
  "version": "1.0.0",
  "description": "Extracts basic metadata from a JSON-formatted UserComment string",
  "author": "Your Name",
  "main": "index.js",
  "priority": 110
}
```

---

## 2. The Implementation (`index.js`)

This script uses the `pixora` global and utility helpers to safely process the metadata.

```javascript
/**
 * Simple JSON Meta Parser
 */

module.exports = pixora.createParser({
  /**
   * detect() should return true if this plugin can handle the file.
   * We check if the "UserComment" keyword exists.
   */
  detect(context, api) {
    return api.utils.hasKeyword(context, "UserComment");
  },

  /**
   * parse() extracts the actual data.
   */
  parse(context, api) {
    // 1. Get the raw text from the "UserComment" keyword
    const rawData = api.utils.getKeyword(context, "UserComment");

    // 2. Decode Base64 content when metadata is encoded
    const decoded = api.utils.decodeBase64(rawData, rawData);

    // 3. Safely parse the JSON using Pixora's helper
    const data = api.utils.parseJSON(decoded);

    // 4. If parsing failed or data isn't an object, return null
    if (!data || typeof data !== "object") {
      return null;
    }

    // 5. Return a structured metadata object
    // Pixora will automatically handle field aliases (like "seed" vs "Seed")
    return {
      prompt: api.utils.asString(data.prompt, "No prompt found"),
      negativePrompt: api.utils.asString(data.negative_prompt, ""),
      model: api.utils.asString(data.model_name, "Unknown Model"),
      sampler: api.utils.asString(data.sampler_name, ""),
      seed: String(data.seed || ""),
      cfgScale: api.utils.toNumber(data.cfg_scale, 7.0),
      width: context.width,
      height: context.height,
      raw: decoded,
    };
  },
});
```

---

## Key Takeaways

### Defensive Programming

Notice the use of `api.utils.parseJSON`. Always use this instead of `JSON.parse`. If the metadata isn't actually JSON, Pixora's helper returns `null` instead of throwing an error that could crash your plugin.

### Using Context

The `context` object already identifies the image dimensions (`context.width`, `context.height`). You can use these directly if your metadata doesn't provide them.

### Debugging

You can add `console.log("Found data:", data)` inside your `parse` function. When **Developer Mode** is enabled in Pixora, these logs will appear instantly in the **Plugin Console**.

### Packaging

To share this plugin, simply zip the `simple-json-meta` folder. Ensure `manifest.json` is at the root of the zip file.
