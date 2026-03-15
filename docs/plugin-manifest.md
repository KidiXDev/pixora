# Plugin Manifest Reference

The `manifest.json` file is required for every Pixora plugin. It defines the plugin's identity, entry point, and execution behavior.

## Manifest Schema

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Human-readable name of the plugin. |
| `version` | `string` | Yes | Semantic version (e.g., `1.0.0`). |
| `description` | `string` | No | A short summary of what the plugin does. |
| `author` | `string` | No | Author name or organization. |
| `main` | `string` | Yes | Relative path to the JavaScript entry file (e.g., `index.js`). |
| `priority` | `number` | No | Execution priority. Higher numbers run first. Default: `100`. |

## Example `manifest.json`

```json
{
  "name": "ComfyUI Basic Parser",
  "version": "1.0.0",
  "description": "Extracts prompt, model, sampler, and seed from ComfyUI PNG metadata",
  "author": "Pixora Community",
  "main": "index.js",
  "priority": 180
}
```

## Plugin ID and Sanitization

Each plugin is assigned an internal **Plugin ID** derived from its folder name.

- **Sanitization**: Any characters other than `a-z`, `0-9`, `.`, `_`, and `-` are replaced with hyphens.
- **Normalization**: The ID is converted to lowercase.
- **Root Relative**: The ID must match the directory name exactly (after sanitization).

## Priority System

Pixora uses a priority-based execution system to determine which plugin handles an image first.

1.  **Detection**: Pixora calls the `detect()` method of all enabled plugins.
2.  **Order**: Plugins that return `true` for `detect()` are sorted by:
    -   `priority` (descending, higher first)
    -   Plugin ID (alphabetical, as a fallback)
3.  **Execution**: The first plugin in the sorted list that successfully returns a metadata object from its `parse()` method "wins."

> [!TIP]
> Use a high priority (e.g., `150+`) if your plugin targets a very specific format to ensure it runs before generic parsers.
