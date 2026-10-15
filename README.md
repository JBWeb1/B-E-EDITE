# B-E-EDITE

An easy, browser-based creative editor that combines a **Canva-style design editor** and a **CapCut-style video editor**. Everything runs locally in the browser, with no server, no sign-up, and nothing to install.

## Getting started

```bash
npm install
npm run dev        # open http://localhost:5173
npm test           # unit tests
npm run build      # production build in dist/
```

## Features

### 🎨 Design editor (Canva-style)
- Canvas sizes for Instagram post/story, YouTube thumbnail, presentation, Facebook cover, A4 poster
- 7 templates with previews (social, video, print, business), filterable by category
- **Magic resize**: switch canvas size and the layout scales to fit
- Text (heading / subheading / body / outlined / shadow), shapes (rectangle, circle, triangle, star, line), and image uploads
- Drag to move, handles to resize, a handle to rotate
- **Multi-select**: drag a box across the canvas, Shift-click, or Ctrl+A, then move, duplicate, delete, lock or copy everything together
- **Align & distribute**: left / center / right / top / middle / bottom (to the page or to each other) and even spacing
- **Right-click menu** with quick actions
- Smart snapping to the canvas center and edges and to other elements (hold **Alt** to disable)
- Double-click text to edit it in place
- Fonts, size, bold/italic, alignment, colors, line height, letter spacing, borders, corner radius, transparency
- Text effects: shadow and outline
- Photo editing: flip, filter presets, brightness/contrast/saturation/blur/B&W
- Solid or **gradient** backgrounds
- Layers panel, bring forward/back, lock, duplicate
- Undo/redo, copy/paste, paste or drag-and-drop images
- Export PNG/JPG at 0.5×, 1× or 2×; save/open editable `.bee.json` project files
- Autosave: the home screen offers "Continue" for your last design
- First-time tips and a keyboard shortcuts panel (press **?**)

### 🎬 Video editor (CapCut-style)
- 16:9, 9:16, 1:1 and 4:5 projects
- Import videos, photos and music (button or drag-and-drop)
- Magnetic main track: drag clips to reorder and drag their edges to trim. Photos can be stretched to any length
- Split at the playhead (**S**), duplicate, delete
- **Transitions** between clips: crossfade, dip to black, slide, zoom, wipe (click ⇄ between two clips; "apply to all")
- Speed (0.25×–4×), volume, fade in/out
- Filter presets (Vivid, Warm, Mono, Fade, Dream) and adjustments: brightness, contrast, saturation, blur, B&W
- Text overlays with styles, background box, and Fade/Pop/Slide-up animations. Drag text on the preview to position it
- Music track with its own trim and volume controls and **waveforms**; overlapping audio and text stack into rows
- **Voice-over recording** from the microphone while the video plays
- Undo/redo, keyboard shortcuts (Space, S, Del, ←/→)
- Export to WebM (MP4 on Safari) with mixed audio
- **Autosave**: your project and media are kept in the browser (IndexedDB), so you can continue from the home screen after closing the tab

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
- [x] First-run tips and a shortcuts panel
- [ ] Full interactive onboarding tour
- [x] Multi-select (shift-click / marquee) and align/distribute tools
- [ ] Grouping
- [x] Right-click context menus
- [x] Template gallery with thumbnails and categories
- [ ] Mobile/touch-friendly layout

Design
- [x] Text effects (shadow, outline, letter spacing)
- [ ] Google Fonts picker, curved text
- [x] Image filters and flip
- [ ] Image crop and background remover
- [ ] Multiple pages, plus PDF export
- [ ] Brand kit (saved colors, fonts, logos)
- [x] Gradient backgrounds
- [ ] Frames and an icon/sticker library

Video
- [x] Transitions between clips (crossfade, dip to black, slide, zoom, wipe)
- [ ] Picture-in-picture overlay track, plus stickers on video
- [ ] Auto captions (speech-to-text) and text-to-speech
- [ ] Keyframe animation (position/scale/opacity)
- [x] Audio waveforms and voice-over recording
- [ ] Beat markers
- [ ] Faster-than-realtime MP4 export (WebCodecs / ffmpeg.wasm)
- [x] Save video projects (media stored in IndexedDB)
- [ ] Several saved projects with a project list

Platform
- [ ] Cloud accounts and sharing; real-time collaboration
- [ ] Desktop app (Tauri/Electron) and PWA install
