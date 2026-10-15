# B-E-EDITE

An easy, browser-based creative editor that combines a **Canva-style design editor** and a **CapCut-style video editor**. Everything runs locally in the browser, with no server, no sign-up, and nothing to install.

## Getting started

```bash
npm install
npm run dev        # open http://localhost:5173
npm test           # unit tests
npm run build      # production build in dist/
```

## What's in v0.1

### 🎨 Design editor (Canva-style)
- Canvas sizes for Instagram post/story, YouTube thumbnail, presentation, Facebook cover, A4 poster
- Starter templates
- **Magic resize**: switch canvas size and the layout scales to fit
- Text (heading / subheading / body), shapes (rectangle, circle, triangle, star, line), and image uploads
- Drag to move, handles to resize, a handle to rotate
- Smart snapping to the canvas center and edges and to other elements (hold **Alt** to disable)
- Double-click text to edit it in place
- Fonts, size, bold/italic, alignment, colors, line height, borders, corner radius, transparency
- Layers panel, bring forward/back, lock, duplicate
- Undo/redo, copy/paste, paste or drag-and-drop images
- Export PNG/JPG at 0.5×, 1× or 2×; save/open editable `.bee.json` project files
- Autosave: the home screen offers "Continue" for your last design

### 🎬 Video editor (CapCut-style)
- 16:9, 9:16, 1:1 and 4:5 projects
- Import videos, photos and music (button or drag-and-drop)
- Magnetic main track: drag clips to reorder and drag their edges to trim. Photos can be stretched to any length
- Split at the playhead (**S**), duplicate, delete
- Speed (0.25×–4×), volume, fade in/out
- Filter presets (Vivid, Warm, Mono, Fade, Dream) and adjustments: brightness, contrast, saturation, blur, B&W
- Text overlays with styles, background box, and Fade/Pop/Slide-up animations. Drag text on the preview to position it
- Separate music track with its own trim and volume controls
- Undo/redo, keyboard shortcuts (Space, S, Del, ←/→)
- Export to WebM (MP4 on Safari) with mixed audio

## Project layout

```
src/
  lib/       shared helpers (undo/redo history, ids, downloads)
  ui/        shared form controls
  home/      start screen
  design/    design editor: types, pure model (geometry, snapping, layers), canvas renderer, UI
  video/     video editor: types, pure timeline logic, playback/export engine, timeline UI
```

The editing logic lives in pure functions (`design/model.ts`, `video/timeline.ts`). These functions are unit-tested and easy to extend. The UI only calls them.

## Roadmap: features to add next

Easier to use
- [ ] Onboarding tour and tooltips; a "what can I do here?" helper
- [ ] Multi-select (shift-click / marquee), grouping, and align/distribute tools
- [ ] Right-click context menus
- [ ] Template gallery with thumbnails and categories
- [ ] Mobile/touch-friendly layout

Design
- [ ] Google Fonts picker, text effects (shadow, outline, curve)
- [ ] Image crop, filters, flip, and background remover
- [ ] Multiple pages, plus PDF export
- [ ] Brand kit (saved colors, fonts, logos)
- [ ] Gradients, frames, and an icon/sticker library

Video
- [ ] Transitions between clips (crossfade, slide, zoom)
- [ ] Picture-in-picture overlay track, plus stickers on video
- [ ] Auto captions (speech-to-text) and text-to-speech
- [ ] Keyframe animation (position/scale/opacity)
- [ ] Audio waveforms, beat markers, voice-over recording
- [ ] Faster-than-realtime MP4 export (WebCodecs / ffmpeg.wasm)
- [ ] Save/load video projects (store media in IndexedDB)

Platform
- [ ] Cloud accounts and sharing; real-time collaboration
- [ ] Desktop app (Tauri/Electron) and PWA install
