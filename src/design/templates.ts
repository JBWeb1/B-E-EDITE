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
  build: () => DesignDoc;
}

export const TEMPLATES: Template[] = [
  {
    label: 'Bold Sale',
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
];
