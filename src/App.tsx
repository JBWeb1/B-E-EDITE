import { useState } from 'react';
import { DesignEditor } from './design/DesignEditor';
import type { DesignDoc } from './design/types';
import { Home } from './home/Home';
import { VideoEditor } from './video/VideoEditor';

export type Screen =
  | { kind: 'home' }
  | { kind: 'design'; doc: DesignDoc }
  | { kind: 'video'; width: number; height: number };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const goHome = () => setScreen({ kind: 'home' });

  if (screen.kind === 'design') return <DesignEditor initialDoc={screen.doc} onExit={goHome} />;
  if (screen.kind === 'video') {
    return <VideoEditor aspect={{ width: screen.width, height: screen.height }} onExit={goHome} />;
  }
  return <Home onOpen={setScreen} />;
}
