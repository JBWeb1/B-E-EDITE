import { addElement, createDoc, createShape, createText } from './model';
import type { DesignDoc, TextElement } from './types';

export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { label: 'Instagram Post', width: 1080, height: 1080 },
  { label: 'Instagram Story', width: 1080, height: 1920 },
  { label: 'YouTube Thumbnail', width: 1280, height: 720 },
  { label: 'Presentation', width: 1920, height: 1080 },
  { label: 'Facebook Cover', width: 1640, height: 624 },
  { label: 'A4 Poster', width: 1240, height: 1754 },
];

/** Text with a height that fits its lines (the editor refits it on the first edit). */
function text(doc: DesignDoc, preset: Partial<TextElement> & { text: string; fontSize: number }): TextElement {
  const lines = preset.text.split('\n').length;
  return createText(doc, { ...preset, height: Math.round(preset.fontSize * (preset.lineHeight ?? 1.2) * lines) });
}

/** Keyframes that slide an element in from `dx` (fraction of the page) while fading in. */
function slideIn(doc: DesignDoc, el: { x: number; y: number; width: number; height: number }, from: number, at = 0) {
  const cx = (el.x + el.width / 2) / doc.width;
  return {
    x: [{ t: at, v: cx + from, ease: 'smooth' as const }, { t: at + 0.8, v: cx, ease: 'smooth' as const }],
    opacity: [{ t: at, v: 0, ease: 'smooth' as const }, { t: at + 0.5, v: 1, ease: 'smooth' as const }],
  };
}

export interface Template {
  label: string;
  category: 'Social' | 'Video' | 'Print' | 'Business';
  build: () => DesignDoc;
}

export const TEMPLATES: Template[] = [
  {
    label: 'Bold Sale',
    category: 'Social',
    build: () => {
      let doc = createDoc(1080, 1080, 'Bold Sale');
      doc.background = '#111827';
      const circle = { ...createShape(doc, 'ellipse'), x: 640, y: -120, width: 600, height: 600, fill: '#f59e0b' };
      doc = addElement(doc, circle);
      doc = addElement(doc, createText(doc, {
        text: 'BIG SALE', fontSize: 170, fontWeight: 'bold', color: '#ffffff',
        fontFamily: 'Impact, sans-serif', x: 90, y: 360, width: 900, height: 204, align: 'left',
      }));
      doc = addElement(doc, createText(doc, {
        text: 'Up to 50% off everything this weekend', fontSize: 48, color: '#fbbf24',
        x: 90, y: 600, width: 800, height: 116, align: 'left',
      }));
      return doc;
    },
  },
  {
    label: 'Quote',
    category: 'Social',
    build: () => {
      let doc = createDoc(1080, 1080, 'Quote');
      doc.background = '#fdf2f8';
      doc = addElement(doc, { ...createShape(doc, 'rect'), x: 80, y: 80, width: 920, height: 920, fill: '#ffffff', radius: 40 });
      doc = addElement(doc, createText(doc, {
        text: '“Creativity is intelligence having fun.”', fontSize: 72, italic: true,
        fontFamily: 'Georgia, serif', color: '#831843', x: 160, y: 360, width: 760, height: 260,
      }));
      doc = addElement(doc, createText(doc, {
        text: '— Albert Einstein', fontSize: 40, color: '#be185d', x: 160, y: 680, width: 760, height: 48,
      }));
      return doc;
    },
  },
  {
    label: 'YouTube Thumbnail',
    category: 'Video',
    build: () => {
      let doc = createDoc(1280, 720, 'Thumbnail');
      doc.background = '#dc2626';
      doc = addElement(doc, { ...createShape(doc, 'rect'), x: 0, y: 470, width: 1280, height: 250, fill: '#111827', radius: 0 });
      doc = addElement(doc, createText(doc, {
        text: 'HOW I EDIT MY VIDEOS', fontSize: 110, fontWeight: 'bold', fontFamily: 'Impact, sans-serif',
        color: '#ffffff', x: 60, y: 130, width: 1160, height: 264,
      }));
      doc = addElement(doc, createText(doc, {
        text: 'Step-by-step tutorial', fontSize: 64, color: '#fde047', x: 60, y: 550, width: 1160, height: 77,
      }));
      return doc;
    },
  },
  {
    label: 'Story Promo',
    category: 'Social',
    build: () => {
      let doc = createDoc(1080, 1920, 'Story Promo');
      doc.gradient = { from: '#7c3aed', to: '#ec4899', angle: 60 };
      doc = addElement(doc, { ...createShape(doc, 'ellipse'), x: -200, y: 1300, width: 800, height: 800, fill: '#ffffff', opacity: 0.12 });
      doc = addElement(doc, createText(doc, {
        text: 'NEW\nDROP', fontSize: 240, fontWeight: 'bold', fontFamily: 'Impact, sans-serif', color: '#ffffff',
        x: 90, y: 560, width: 900, height: 576, lineHeight: 1.2, shadow: true, letterSpacing: 8,
      }));
      doc = addElement(doc, { ...createShape(doc, 'rect'), x: 290, y: 1300, width: 500, height: 120, fill: '#ffffff', radius: 60 });
      doc = addElement(doc, createText(doc, {
        text: 'Shop now', fontSize: 56, fontWeight: 'bold', color: '#7c3aed', x: 290, y: 1326, width: 500, height: 67,
      }));
      return doc;
    },
  },
  {
    label: 'Birthday',
    category: 'Social',
    build: () => {
      let doc = createDoc(1080, 1080, 'Birthday');
      doc.gradient = { from: '#fdf2f8', to: '#e0e7ff', angle: 45 };
      for (const [x, y, size, fill] of [[120, 140, 90, '#f472b6'], [860, 200, 70, '#fbbf24'], [180, 820, 60, '#60a5fa'], [840, 820, 100, '#a78bfa']] as const) {
        doc = addElement(doc, { ...createShape(doc, 'star'), x, y, width: size, height: size, fill });
      }
      doc = addElement(doc, createText(doc, {
        text: 'Happy Birthday!', fontSize: 120, fontFamily: '"Brush Script MT", cursive', color: '#be185d',
        x: 90, y: 400, width: 900, height: 144,
      }));
      doc = addElement(doc, createText(doc, {
        text: 'Wishing you a wonderful year', fontSize: 44, color: '#4c1d95', x: 140, y: 600, width: 800, height: 53,
      }));
      return doc;
    },
  },
  {
    label: 'Event Poster',
    category: 'Print',
    build: () => {
      let doc = createDoc(1240, 1754, 'Event Poster');
      doc.gradient = { from: '#0f172a', to: '#1e3a8a', angle: 90 };
      doc = addElement(doc, { ...createShape(doc, 'ellipse'), x: 620, y: -200, width: 900, height: 900, fill: '#06b6d4', opacity: 0.35 });
      doc = addElement(doc, createText(doc, {
        text: 'SUMMER\nMUSIC FEST', fontSize: 130, fontWeight: 'bold', fontFamily: 'Arial Black, sans-serif', color: '#ffffff',
        x: 100, y: 700, width: 1040, height: 312, align: 'left', outlineWidth: 0, letterSpacing: 4,
      }));
      doc = addElement(doc, { ...createShape(doc, 'line'), x: 100, y: 1110, width: 400, height: 0, stroke: '#22d3ee', strokeWidth: 10 });
      doc = addElement(doc, createText(doc, {
        text: 'August 24 · City Park · 6PM', fontSize: 60, color: '#a5f3fc', x: 100, y: 1170, width: 1040, height: 72, align: 'left',
      }));
      return doc;
    },
  },
  {
    label: 'Presentation Title',
    category: 'Business',
    build: () => {
      let doc = createDoc(1920, 1080, 'Presentation');
      doc.background = '#ffffff';
      doc = addElement(doc, { ...createShape(doc, 'rect'), x: 0, y: 0, width: 640, height: 1080, fill: '#4f46e5', radius: 0 });
      doc = addElement(doc, createText(doc, {
        text: 'Quarterly Review', fontSize: 120, fontWeight: 'bold', color: '#111827', x: 760, y: 380, width: 1060, height: 144, align: 'left',
      }));
      doc = addElement(doc, createText(doc, {
        text: 'Results, highlights and next steps', fontSize: 52, color: '#6b7280', x: 760, y: 560, width: 1060, height: 62, align: 'left',
      }));
      return doc;
    },
  },
  {
    label: 'Podcast Cover',
    category: 'Social',
    build: () => {
      let doc = createDoc(1080, 1080, 'Podcast Cover');
      doc.gradient = { from: '#111827', to: '#4c1d95', angle: 135 };
      doc = addElement(doc, { ...createShape(doc, 'ellipse'), x: 290, y: 150, width: 500, height: 500, fill: 'transparent', stroke: '#a78bfa', strokeWidth: 14 });
      doc = addElement(doc, { ...createShape(doc, 'ellipse'), x: 390, y: 250, width: 300, height: 300, fill: '#a78bfa', opacity: 0.85 });
      doc = addElement(doc, text(doc, { text: 'THE CREATIVE HOUR', fontSize: 74, fontWeight: 'bold', fontFamily: 'Impact, sans-serif', color: '#ffffff', x: 60, y: 720, width: 960, letterSpacing: 4 }));
      doc = addElement(doc, text(doc, { text: 'Weekly conversations with makers', fontSize: 42, color: '#c4b5fd', x: 60, y: 850, width: 960 }));
      return doc;
    },
  },
  {
    label: 'Recipe Story',
    category: 'Social',
    build: () => {
      let doc = createDoc(1080, 1920, 'Recipe Story');
      doc.background = '#fff7ed';
      doc = addElement(doc, { ...createShape(doc, 'rect'), x: 0, y: 0, width: 1080, height: 760, fill: '#fb923c', radius: 0 });
      doc = addElement(doc, text(doc, { text: '15-MINUTE\nPASTA', fontSize: 150, fontWeight: 'bold', fontFamily: 'Arial Black, sans-serif', color: '#ffffff', x: 80, y: 220, width: 920, align: 'left', lineHeight: 1.1 }));
      doc = addElement(doc, text(doc, { text: 'You need:', fontSize: 60, fontWeight: 'bold', color: '#9a3412', x: 80, y: 860, width: 920, align: 'left' }));
      doc = addElement(doc, text(doc, { text: '• 200 g spaghetti\n• 2 cloves garlic\n• Olive oil & chilli\n• Parmesan & parsley', fontSize: 54, color: '#431407', x: 80, y: 960, width: 920, align: 'left', lineHeight: 1.5 }));
      doc = addElement(doc, { ...createShape(doc, 'rect'), x: 80, y: 1560, width: 920, height: 150, fill: '#9a3412', radius: 75 });
      doc = addElement(doc, text(doc, { text: 'Swipe up for the recipe', fontSize: 54, fontWeight: 'bold', color: '#ffffff', x: 80, y: 1603, width: 920 }));
      return doc;
    },
  },
  {
    label: 'Fitness Class',
    category: 'Social',
    build: () => {
      let doc = createDoc(1080, 1350, 'Fitness Class');
      doc.background = '#0a0a0a';
      doc = addElement(doc, { ...createShape(doc, 'triangle'), x: 520, y: -80, width: 700, height: 700, fill: '#84cc16', rotation: 20, opacity: 0.9 });
      doc = addElement(doc, text(doc, { text: 'HIIT\nBURN', fontSize: 230, fontWeight: 'bold', fontFamily: 'Impact, sans-serif', color: '#ffffff', x: 70, y: 520, width: 940, align: 'left', lineHeight: 1 }));
      doc = addElement(doc, text(doc, { text: 'Every Tuesday · 7 AM · Studio 3', fontSize: 48, color: '#bef264', x: 70, y: 1040, width: 940, align: 'left' }));
      doc = addElement(doc, { ...createShape(doc, 'rect'), x: 70, y: 1150, width: 420, height: 90, fill: '#84cc16', radius: 45 });
      doc = addElement(doc, text(doc, { text: 'First class free', fontSize: 40, fontWeight: 'bold', color: '#0a0a0a', x: 70, y: 1171, width: 420 }));
      return doc;
    },
  },
  {
    label: 'Real Estate',
    category: 'Business',
    build: () => {
      let doc = createDoc(1080, 1080, 'Real Estate');
      doc.background = '#f8fafc';
      doc = addElement(doc, { ...createShape(doc, 'rect'), x: 60, y: 60, width: 960, height: 600, fill: '#cbd5e1', radius: 24 });
      doc = addElement(doc, text(doc, { text: 'Add your photo here', fontSize: 40, color: '#64748b', x: 60, y: 336, width: 960 }));
      doc = addElement(doc, text(doc, { text: 'JUST LISTED', fontSize: 84, fontWeight: 'bold', color: '#0f172a', x: 60, y: 710, width: 960, align: 'left' }));
      doc = addElement(doc, text(doc, { text: '3 bed · 2 bath · garden · near the park', fontSize: 40, color: '#475569', x: 60, y: 820, width: 960, align: 'left' }));
      doc = addElement(doc, { ...createShape(doc, 'rect'), x: 60, y: 910, width: 360, height: 100, fill: '#0f766e', radius: 16 });
      doc = addElement(doc, text(doc, { text: '$425,000', fontSize: 48, fontWeight: 'bold', color: '#ffffff', x: 60, y: 931, width: 360 }));
      return doc;
    },
  },
  {
    label: 'Webinar Banner',
    category: 'Business',
    build: () => {
      let doc = createDoc(1640, 624, 'Webinar Banner');
      doc.gradient = { from: '#0ea5e9', to: '#6366f1', angle: 20 };
      doc = addElement(doc, { ...createShape(doc, 'hexagon'), x: 1220, y: 90, width: 440, height: 440, fill: '#ffffff', opacity: 0.12 });
      doc = addElement(doc, text(doc, { text: 'FREE LIVE WEBINAR', fontSize: 36, fontWeight: 'bold', color: '#e0f2fe', x: 90, y: 150, width: 1100, align: 'left', letterSpacing: 6 }));
      doc = addElement(doc, text(doc, { text: 'Grow your brand with video', fontSize: 84, fontWeight: 'bold', color: '#ffffff', x: 90, y: 220, width: 1460, align: 'left' }));
      doc = addElement(doc, text(doc, { text: 'Thursday, 5 PM · Register at yoursite.com', fontSize: 40, color: '#e0e7ff', x: 90, y: 370, width: 1200, align: 'left' }));
      return doc;
    },
  },
  {
    label: 'Restaurant Menu',
    category: 'Print',
    build: () => {
      let doc = createDoc(1240, 1754, 'Restaurant Menu');
      doc.background = '#1c1917';
      doc = addElement(doc, text(doc, { text: 'Trattoria Luna', fontSize: 120, fontFamily: '"Brush Script MT", cursive', color: '#fbbf24', x: 100, y: 120, width: 1040 }));
      doc = addElement(doc, { ...createShape(doc, 'line'), x: 420, y: 300, width: 400, height: 0, stroke: '#fbbf24', strokeWidth: 4 });
      const dishes = [
        ['Bruschetta', 'Tomato, basil, garlic', '8'],
        ['Margherita', 'Mozzarella, tomato, basil', '12'],
        ['Tagliatelle', 'Slow-cooked ragù', '15'],
        ['Risotto', 'Mushrooms & parmesan', '14'],
        ['Tiramisù', 'House recipe', '7'],
      ];
      dishes.forEach(([name, desc, price], i) => {
        const y = 420 + i * 230;
        doc = addElement(doc, text(doc, { text: name, fontSize: 64, fontWeight: 'bold', fontFamily: 'Georgia, serif', color: '#fafaf9', x: 120, y, width: 800, align: 'left' }));
        doc = addElement(doc, text(doc, { text: desc, fontSize: 38, italic: true, fontFamily: 'Georgia, serif', color: '#a8a29e', x: 120, y: y + 84, width: 800, align: 'left' }));
        doc = addElement(doc, text(doc, { text: `$${price}`, fontSize: 60, fontWeight: 'bold', color: '#fbbf24', x: 920, y, width: 200, align: 'right' }));
      });
      return doc;
    },
  },
  {
    label: 'Thank You Card',
    category: 'Print',
    build: () => {
      let doc = createDoc(1500, 1050, 'Thank You Card');
      doc.gradient = { from: '#ecfeff', to: '#fef9c3', angle: 30 };
      for (const [x, y, size, fill] of [[150, 140, 110, '#fda4af'], [1250, 180, 80, '#93c5fd'], [1220, 800, 120, '#fcd34d'], [180, 820, 70, '#86efac']] as const) {
        doc = addElement(doc, { ...createShape(doc, 'heart'), x, y, width: size, height: size, fill });
      }
      doc = addElement(doc, text(doc, { text: 'Thank you!', fontSize: 190, fontFamily: '"Brush Script MT", cursive', color: '#0f766e', x: 150, y: 330, width: 1200 }));
      doc = addElement(doc, text(doc, { text: 'for being part of our special day', fontSize: 52, color: '#334155', x: 150, y: 600, width: 1200 }));
      return doc;
    },
  },
  {
    label: 'Animated Launch',
    category: 'Video',
    build: () => {
      let doc = createDoc(1920, 1080, 'Animated Launch');
      doc.gradient = { from: '#020617', to: '#312e81', angle: 45 };
      const orb = { ...createShape(doc, 'ellipse'), x: 1200, y: 200, width: 600, height: 600, fill: '#22d3ee', opacity: 0.25 };
      doc = addElement(doc, {
        ...orb,
        keys: { scale: [{ t: 0, v: 0.6, ease: 'smooth' }, { t: 2.5, v: 1.15, ease: 'smooth' }] },
      });
      const title = text(doc, { text: 'Introducing Nova', fontSize: 150, fontWeight: 'bold', color: '#ffffff', x: 140, y: 380, width: 1300, align: 'left' });
      doc = addElement(doc, { ...title, keys: slideIn(doc, title, -0.15, 0.2) });
      const sub = text(doc, { text: 'The fastest way to make videos', fontSize: 60, color: '#a5b4fc', x: 140, y: 580, width: 1300, align: 'left' });
      doc = addElement(doc, { ...sub, keys: slideIn(doc, sub, -0.15, 0.6) });
      const star = { ...createShape(doc, 'star'), x: 1400, y: 760, width: 140, height: 140, fill: '#fde047' };
      doc = addElement(doc, {
        ...star,
        keys: { rotation: [{ t: 0, v: 0, ease: 'linear' }, { t: 4, v: 360, ease: 'linear' }], opacity: [{ t: 1, v: 0, ease: 'smooth' }, { t: 1.4, v: 1, ease: 'smooth' }] },
      });
      return doc;
    },
  },
];
