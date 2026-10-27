import { describe, expect, it } from 'vitest';
import { imageSizeFor } from './aiService';
import { creditLine, fromOpenverse, fromPexels, stockFileName } from './stock';

describe('stock library', () => {
  it('reads Openverse photos with their licence and credit', () => {
    const [p] = fromOpenverse('image', [{ id: 'abc', title: ' Sunset ', url: 'https://x/full.jpg', thumbnail: 'https://x/t.jpg', width: 4000, height: 3000, creator: 'Ana', license: 'by', license_version: '4.0', source: 'flickr', foreign_landing_url: 'https://flickr/abc' }]);
    expect(p).toMatchObject({ id: 'ov-abc', title: 'Sunset', thumb: 'https://x/t.jpg', fallback: 'https://api.openverse.org/v1/images/abc/thumb/', license: 'CC BY 4.0', source: 'flickr' });
    expect(creditLine(p)).toBe('“Sunset” by Ana (CC BY 4.0) via flickr');
    expect(stockFileName(p, 'image/jpeg')).toBe('Sunset by Ana (CC BY 4.0).jpg');
    const [s] = fromOpenverse('audio', [{ id: 's1', url: 'https://x/a.mp3', duration: 61500, license: 'cc0' }]);
    expect(s).toMatchObject({ title: 'Sound', duration: 61.5, license: 'CC0', creator: 'Unknown' });
  });
  it('picks the HD file of a Pexels video', () => {
    const [v] = fromPexels([
      {
        id: 7, url: 'https://pexels/7', image: 'https://pexels/7.jpg', duration: 12, width: 3840, height: 2160, user: { name: 'Bo' },
        video_files: [
          { link: '4k.mp4', width: 3840, height: 2160, file_type: 'video/mp4' },
          { link: 'hd.mp4', width: 1920, height: 1080, file_type: 'video/mp4' },
          { link: 'sd.mp4', width: 640, height: 360, file_type: 'video/mp4' },
        ],
      },
    ]);
    expect(v).toMatchObject({ url: 'hd.mp4', fallback: 'sd.mp4', duration: 12, creator: 'Bo', kind: 'video' });
  });
  it('asks for the picture size closest to the page shape', () => {
    expect(imageSizeFor(16 / 9)).toBe('1536x1024');
    expect(imageSizeFor(9 / 16)).toBe('1024x1536');
    expect(imageSizeFor(1)).toBe('1024x1024');
    expect(imageSizeFor(4 / 5)).toBe('1024x1536');
  });
});
