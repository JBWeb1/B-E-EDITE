# B-E Motion

<img src="public/brand/b-e-motion-logo.png" alt="B-E Motion logo" width="320" />

An easy, browser-based creative editor that combines a **Canva-style design editor** and a **CapCut-style video editor**. Everything runs locally in the browser, with no server, no sign-up, and nothing to install.

## Getting started

```bash
npm install
npm run dev        # open http://localhost:5173
npm test           # unit tests
npm run build      # production build in dist/
```

## Features

### ✨ Look & feel
- Clean dark interface with an icon set, gradient accents, and smooth hover/focus states
- Tidy top bar: every export option lives in one **Download** menu
- Works on phones: panels stack, and tapping the open tab again folds the side panel away

### 📁 My projects
- Every design and video is saved automatically in your browser (IndexedDB) and listed on the home screen with a preview
- Open, search and delete projects; video media files are stored with the project

### 🎨 Design editor (Canva-style)
- Canvas sizes for Instagram post/story, YouTube thumbnail, presentation, Facebook cover, A4 poster
- **Multiple pages** (great for presentations and carousels): add, duplicate, reorder and delete pages from the page strip
- **Present mode**: full-screen slideshow with arrow-key navigation
- **Animations**: per-element entrances (fade, rise, pop, slide, wipe) or "Animate this page"; download the design as an **animated video**
- 7 templates with previews (social, video, print, business), filterable by category
- **Magic resize**: switch canvas size and the layout scales to fit
- Text (heading / subheading / body / outlined / shadow), 10 shapes (rectangle, circle, triangle, star, line, heart, arrow, speech bubble, hexagon, diamond), emoji stickers, and image uploads
- Drag to move, handles to resize, a handle to rotate
- **Multi-select**: drag a box across the canvas, Shift-click, or Ctrl+A, then move, duplicate, delete, lock or copy everything together
- **Align & distribute**: left / center / right / top / middle / bottom (to the page or to each other) and even spacing
- **Right-click menu** with quick actions
- Smart snapping to the canvas center and edges and to other elements (hold **Alt** to disable)
- Double-click text to edit it in place
- Fonts, size, bold/italic, alignment, colors, line height, letter spacing, borders, corner radius, transparency
- Text effects: shadow and outline
- **Background remover** for photos with a plain background (white, green screen, studio wall), with a strength slider and Restore
- Photo editing: **crop** (Original, 1:1, 4:5, 3:2, 16:9, 9:16 with zoom and position), flip, filter presets, brightness/contrast/saturation/blur/B&W
- One-click swatches of colors already used in the design
- Solid or **gradient** backgrounds
- Layers panel, bring forward/back, lock, duplicate
- Undo/redo, copy/paste, paste or drag-and-drop images
- Export PNG/JPG at 0.5×, 1× or 2×, a print-ready multi-page **PDF**, or an animated video; save/open editable `.bee.json` project files
- First-time tips and a keyboard shortcuts panel (press **?**)

### 🎬 Video editor (CapCut-style)
- 16:9, 9:16, 1:1 and 4:5 projects
- Import videos, photos and music (button or drag-and-drop)
- Magnetic main track: drag clips to reorder and drag their edges to trim. Photos can be stretched to any length
- Split at the playhead (**S**), duplicate, delete
- **Transitions** between clips: crossfade, dip to black, slide, zoom, wipe (click ⇄ between two clips; "apply to all")
- Speed (0.25×–4×), volume, fade in/out
- **Motion** (Ken Burns): zoom in/out or pan across a clip, great for photo slideshows
- **Picture-in-picture**: put a photo or video on top (⧉ on a media card), drag it on the preview, resize, round the corners
- **Blur background**: fill the empty space around clips that don't match the frame shape (e.g. landscape clips in a vertical video)
- Filter presets (Vivid, Warm, Mono, Fade, Dream) and adjustments: brightness, contrast, saturation, blur, B&W
- Text overlays with styles, background box, and Fade/Pop/Slide-up animations. Drag text on the preview to position it
- Emoji stickers
- **Captions**: type a script and it becomes timed captions, or import/export `.srt` subtitle files (`.vtt` import too)
- **Magnetic snapping**: dragged items snap to the playhead, clip edges and other items (hold **Alt** to turn off)
- Music track with its own trim, volume and **fade in/out** controls and **waveforms**; overlapping audio and text stack into rows
- **Voice-over recording** from the microphone while the video plays
- Undo/redo, keyboard shortcuts (Space, S, Del, ←/→)
- Export to WebM (MP4 on Safari) with mixed audio; choose quality (small / standard / high) and 30 or 60 fps, with a file-size estimate

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
- [x] Phone-friendly layout

Design
- [x] Text effects (shadow, outline, letter spacing)
- [ ] Google Fonts picker, curved text
- [x] Image filters and flip
- [x] Image crop
- [x] Background remover (plain backgrounds)
- [ ] AI background remover for busy backgrounds
- [x] PDF export
- [x] Multiple pages, present mode, animations
- [x] Quick reuse of colors already in the design
- [ ] Brand kit (saved colors, fonts, logos)
- [x] Gradient backgrounds
- [x] More shapes and emoji stickers
- [ ] Frames and an icon library

Video
- [x] Transitions between clips (crossfade, dip to black, slide, zoom, wipe)
- [x] Picture-in-picture overlay track, plus stickers on video
- [x] Captions from a script and .srt import/export
- [ ] Automatic speech-to-text captions and text-to-speech
- [x] Motion presets (zoom/pan)
- [ ] Full keyframe animation (position/scale/opacity)
- [x] Audio waveforms and voice-over recording
- [ ] Beat markers
- [ ] Faster-than-realtime MP4 export (WebCodecs / ffmpeg.wasm)
- [x] Save video projects (media stored in IndexedDB)
- [x] Several saved projects with a project list

Platform
- [ ] Cloud accounts and sharing; real-time collaboration
- [ ] Desktop app (Tauri/Electron) and PWA install
