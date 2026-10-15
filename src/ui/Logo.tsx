import logoMark from '../assets/logo-mark.png';

export const APP_NAME = 'B-E Motion';

/** The B-E Motion mark (white, transparent background). */
export function Logo({ height = 24, className = '' }: { height?: number; className?: string }) {
  return <img src={logoMark} alt={APP_NAME} height={height} style={{ height, width: 'auto' }} className={`logo ${className}`} draggable={false} />;
}
