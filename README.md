<div align="center">
  <img src="assets/pixora_logo.png" width="160" height="160" alt="Pixora Logo">
  <h1>Pixora</h1>
  <p><strong>The Intelligent AI-Generated Image Gallery</strong></p>
  <p>
    <img src="https://img.shields.io/badge/Wails-v3-00ADD8?style=flat-square&logo=go" alt="Wails v3">
    <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19">
    <img src="https://img.shields.io/badge/TypeScript-latest-3178C6?style=flat-square&logo=typescript" alt="TypeScript">
    <img src="https://img.shields.io/badge/Tailwind-v4-06B6D4?style=flat-square&logo=tailwindcss" alt="Tailwind CSS v4">
  </p>
</div>

## ✨ Overview

**Pixora** is a high-performance, premium desktop gallery designed specifically for AI-generated art. It combines the speed of Go with the beauty of React 19 to provide a seamless experience for managing, inspecting, and comparing your AI creations.

## 🚀 Key Features

### ♾️ Smooth Infinity Scroll

Experience zero-lag browsing. Pixora utilizes advanced virtualization techniques to handle libraries with tens of thousands of images without breaking a sweat.

### 🔍 Deep Metadata Inspector

Uncover the secrets behind every image. Pixora automatically parses prompts, seeds, samplers, and model information from your AI-generated files.

### ⚖️ Image Comparison

Need to pick between two versions? Use our side-by-side comparison tool with a smooth interactive slider to spot the subtle differences in your generations.

### 🧩 Secure Plugin Architecture

Pixora features a JavaScript-based plugin system that allows the community to add support for new AI tools and file formats.

## 🛠️ Tech Stack

- **Core Engine:** [Wails v3](https://v3.wails.io/) (Golang)
- **Frontend UI:** React 19 + TypeScript
- **Styling:** Tailwind CSS v4 + Framer Motion
- **Database:** SQLite (Embedded)

## 📦 Getting Started

### Prerequisites

- [Go](https://go.dev/dl/) (v1.25+)
- [Node.js](https://nodejs.org/) (v20+)
- [Wails v3 CLI](https://v3alpha.wails.io/quick-start/installation/)

### Installation & Development

1. **Clone the repository:**

   ```bash
   git clone https://github.com/kidixdev/pixora.git
   cd pixora
   ```

2. **Run in Development Mode:**

   ```bash
   wails3 dev
   ```

   This will start the app with hot-reloading enabled for both the Go backend and the React frontend.

3. **Build for Production:**
   ```bash
   wails3 build
   ```
   The production-ready executable will be generated in the `bin/` directory.

## 🎨 Plugin System

Pixora is built to be extended. You can create your own metadata parsers in JavaScript.

**Structure:**

```text
plugins/
   my-parser/
      manifest.json
      index.js
```

Check out the [Plugin Documentation](docs/plugins.md) or the `plugins/example-parser-plugin` for more details.

---

<div align="center">
  <p>Crafted with ❤️ for the AI Art Community</p>
</div>
