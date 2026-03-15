# Plugin Development Guide

This guide covers the sandbox environment, debugging, and best practices for developing Pixora plugins.

## Sandbox Environment

Plugins run in a secure sandbox to protect the host system.

### Restrictions

- **No File System**: `fs` or `path` modules are not available.
- **No Network**: `fetch`, `http`, or `websocket` access is blocked.
- **No Process Access**: `process` and environment variables are restricted.
- **No `require`**: You cannot import modular libraries. All logic must be contained within your plugin file.
- **Size Limit**: Maximum script size is `512 KB`.
- **Time Limit**: Execution timeout is `200 ms` per call. If exceeded, the plugin is killed.

## Debugging Plugins

Pixora provides a **Plugin Console** for developers.

1.  Enable **Developer Mode** in Pixora Settings.
2.  Open the **Developer** section in the sidebar.
3.  Any `console.log`, `console.warn`, or `console.error` calls in your plugin will appear here in real-time.

```javascript
// Example debugging
detect(context) {
    console.log("Checking file:", context.filePath);
    return true;
}
```

## Community Publishing Checklist

Before sharing your plugin with others:

1.  **Test with Samples**: Include sample images that your plugin is designed to parse.
2.  **Be Conservative**: Return `null` if you aren't 100% sure the metadata belongs to your format.
3.  **Use Priorities**: Set a `priority` in `manifest.json` if you are overriding a common format.
4.  **Documentation**: Include a `README.md` inside your plugin folder.
5.  **Packaging**: Distribute as a `.zip` file. Ensure `manifest.json` is at the root.

## Best Practices

- **Performance**: Use `api.utils` helpers instead of reimplementing common logic.
- **Safety**: Always use `api.utils.parseJSON` instead of `JSON.parse` to avoid unhandled exceptions crashing the sandbox.
- **Encoded Metadata**: Use `api.utils.decodeBase64(value, fallback)` for Base64 metadata values instead of writing your own decoder in plugin code.
- **Fallbacks**: If a specific field (like `seed`) isn't found, leave it out of the return object rather than returning an empty string.
