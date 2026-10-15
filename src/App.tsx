import { useState } from 'react';
import { createDoc } from './design/model';
import { toFile } from './design/pages';
import { newProjectId } from './lib/projects';
import { DesignEditor } from './design/DesignEditor';
import type { DesignFile } from './design/types';
import { Home } from './home/Home';
import type { VideoProject } from './video/types';
import { VideoEditor } from './video/VideoEditor';

export type Screen =
  | { kind: 'home' }
  | { kind: 'design'; file: DesignFile; projectId: string }
  | { kind: 'video'; width: number; height: number; projectId: string; project?: VideoProject };

export function App() {
  const [screen, setScreen] = useState<Screen>(startScreen);
  const goHome = () => setScreen({ kind: 'home' });

  if (screen.kind === 'design') {
    return <DesignEditor key={screen.projectId} initialFile={screen.file} projectId={screen.projectId} onExit={goHome} />;
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

/** The installed app's shortcuts open `?new=video` / `?new=design` straight into an editor. */
function startScreen(): Screen {
  const wanted = new URLSearchParams(window.location.search).get('new');
  if (wanted) window.history.replaceState(null, '', window.location.pathname);
  if (wanted === 'video') return { kind: 'video', width: 1280, height: 720, projectId: newProjectId() };
  if (wanted === 'design') return { kind: 'design', file: toFile(createDoc(1080, 1080, 'Instagram Post')), projectId: newProjectId() };
  return { kind: 'home' };
}
