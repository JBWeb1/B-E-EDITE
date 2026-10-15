import { addElement, createDoc, createShape, createText } from './model';
import type { DesignDoc } from './types';

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
        text: 'SUMMER\nMUSIC FEST', fontSize: 170, fontWeight: 'bold', fontFamily: 'Arial Black, sans-serif', color: '#ffffff',
        x: 100, y: 620, width: 1040, height: 408, align: 'left', outlineWidth: 0, letterSpacing: 4,
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
];
