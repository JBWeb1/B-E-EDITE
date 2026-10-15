import { useState } from 'react';
import { DesignEditor } from './design/DesignEditor';
import type { DesignDoc } from './design/types';
import { Home } from './home/Home';
import type { VideoProject } from './video/types';
import { VideoEditor } from './video/VideoEditor';

export type Screen =
  | { kind: 'home' }
  | { kind: 'design'; doc: DesignDoc; projectId: string }
  | { kind: 'video'; width: number; height: number; projectId: string; project?: VideoProject };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const goHome = () => setScreen({ kind: 'home' });

  if (screen.kind === 'design') {
    return <DesignEditor key={screen.projectId} initialDoc={screen.doc} projectId={screen.projectId} onExit={goHome} />;
  }
  if (screen.kind === 'video') {
    return (
      <VideoEditor
        key={screen.projectId}
        aspect={{ width: screen.width, height: screen.height }}
        initialProject={screen.project}
        projectId={screen.projectId}
        onExit={goHome}
      />
    );
  }
  return <Home onOpen={setScreen} />;
}
