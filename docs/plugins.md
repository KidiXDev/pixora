# Pixora Parser Plugins

Pixora supports custom JavaScript plugins to extract metadata from your images. This allows the community to add support for new AI generators, workflows, and formats without modifying the core application.

---

## Getting Started

If you are new to Pixora plugins, start with the overview and development guide.

- [**Overview & Manifest**](plugin-manifest.md): Learn how to structure your plugin and define its properties.
- [**Development Guide**](plugin-development.md): Sandbox rules, debugging with the Plugin Console, and best practices.

## Reference

Detailed technical specifications for plugin authors.

- [**Runtime API Reference**](plugin-api.md): Detailed explanation of the `pixora` global, `context` object, and utility helpers.
- [**Example Implementation**](plugin-example.md): A walkthrough of a real-world ComfyUI parser plugin.

---

## Core Concepts

### Simplicity First
Keep plugins deterministic. A plugin should take a fixed input (the image metadata context) and return a structured output. Avoid complex external dependencies or state.

### Sandbox Security
Plugins run in a isolated environment. They cannot access your files, network, or hardware. This ensures that installing plugins from the community is safe.

### Priority System
Pixora allows multiple plugins to coexist. If multiple plugins claim they can parse a file, the one with the highest **priority** runs first.

---

## Contributing
Have you built a great parser? Share it with the Pixora community!
1. Package your plugin folder into a `.zip` file.
2. Share it on our community forums or GitHub discussions.
