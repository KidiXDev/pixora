# Plugin Runtime API

Pixora plugins run in a sandboxed JavaScript environment. This document describes the available globals and types.

## The `pixora` Global

Every plugin has access to a `pixora` global object.

### `pixora.version`

Returns the API version string. Current version: `"1"`.

### `pixora.createParser(definition)`

The recommended way to define a plugin.

- **Arguments**: An object with `detect` and `parse` methods.
- **Returns**: A parser object compatible with the runtime.

```javascript
module.exports = pixora.createParser({
  detect(context, api) {
    /* ... */
  },
  parse(context, api) {
    /* ... */
  },
});
```

---

## The `context` Object

The `context` object is passed to both `detect()` and `parse()`. It contains information about the file being processed.

| Field           | Type     | Description                                                              |
| :-------------- | :------- | :----------------------------------------------------------------------- |
| `filePath`      | `string` | Full path to the image file.                                             |
| `extension`     | `string` | File extension (e.g., `.png`, `.jpg`).                                   |
| `width`         | `number` | Image width in pixels.                                                   |
| `height`        | `number` | Image height in pixels.                                                  |
| `raw`           | `string` | Raw metadata string (e.g., the contents of the `tEXt` chunk).            |
| `textByKeyword` | `object` | Map of metadata keywords to their values.                                |
| `textEntries`   | `array`  | List of entries: `{ keyword: string, text: string, chunkType: string }`. |

---

## The `api` (utils) Helper

The second argument to `detect` and `parse` provides utility functions.

- `api.utils.asString(value, fallback)`: Forces value to string.
- `api.utils.toNumber(value, fallback)`: Forces value to number.
- `api.utils.parseJSON(text)`: Safely parses JSON; returns `null` on failure (no throw).
- `api.utils.getKeyword(context, key)`: Retrieves value for a specific keyword from context.
- `api.utils.hasKeyword(context, key)`: Returns `true` if keyword exists.
- `api.utils.parseDimensions(value)`: Parses strings like `"1024x1024"` into `{ width: number, height: number }`.
- `api.utils.decodeBase64(value, fallback)`: Safely decodes Base64 to UTF-8 text. Supports standard, URL-safe, raw (unpadded), and `data:*;base64,` payloads. Returns `fallback` on invalid input.

---

## Metadata Return Shape

The `parse()` function should return a metadata object. Pixora is flexible with field naming and supports several aliases (case-insensitive where applicable).

| Field            | Description                        | Supported Aliases                                      |
| :--------------- | :--------------------------------- | :----------------------------------------------------- |
| `prompt`         | Primary generation prompt.         | `Prompt`                                               |
| `negativePrompt` | Negative or exclusion prompt.      | `negative_prompt`, `NegativePrompt`, `Negative_Prompt` |
| `model`          | Model name or checkpoint hash.     | `Model`                                                |
| `sampler`        | Sampling algorithm name.           | `Sampler`                                              |
| `seed`           | Generation seed.                   | `Seed`                                                 |
| `cfgScale`       | Classifier Free Guidance scale.    | `cfg`, `CfgScale`, `CFGScale`                          |
| `width`          | Final image width.                 | `Width`                                                |
| `height`         | Final image height.                | `Height`                                               |
| `raw`            | The original raw metadata payload. | `Raw`                                                  |

If the plugin cannot parse the metadata, it should return `null` or `undefined`.
