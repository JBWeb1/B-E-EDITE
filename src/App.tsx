import { useState } from 'react';
import { createDoc } from './design/model';
import { toFile } from './design/pages';
import { newProjectId } from './lib/projects';
import { DesignEditor } from './design/DesignEditor';
import type { DesignFile } from './design/types';
import { Home } from './home/Home';
import type { VideoProject } from './video/types';
import { VideoEditor } from './video/VideoEditor';
import { LiveJoin } from './share/LiveJoin';
import { PhoneLink } from './share/PhoneLink';
import type { Peer } from './lib/p2p';

export type Screen =
  | { kind: 'home' }
  | { kind: 'design'; file: DesignFile; projectId: string }
  | { kind: 'video'; width: number; height: number; projectId: string; project?: VideoProject; template?: string; live?: Peer }
  | { kind: 'phone'; code: string }
  | { kind: 'live-join'; code: string };

export function App() {
  const [screen, setScreen] = useState<Screen>(startScreen);
  const goHome = () => setScreen({ kind: 'home' });

  if (screen.kind === 'phone') return <PhoneLink code={screen.code} onDone={goHome} />;
  if (screen.kind === 'live-join') {
    return (
      <LiveJoin
        code={screen.code}
        onCancel={goHome}
        onOpen={(project, projectId, peer) => setScreen({ kind: 'video', width: project.width, height: project.height, projectId, project, live: peer })}
      />
    );
  }
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
        template={screen.template}
        live={screen.live}
        onOpenDesign={(file, projectId) => setScreen({ kind: 'design', file, projectId })}
        onExit={goHome}
      />
    );
  }
  return <Home onOpen={setScreen} />;
}

/** The installed app's shortcuts open `?new=video` / `?new=design` straight into an editor. */
function startScreen(): Screen {
  // Links from "Send from your phone" and "Edit together, live".
  const link = window.location.hash.match(/^#(pair|live)=(.+)$/);
  if (link) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return link[1] === 'pair' ? { kind: 'phone', code: link[2] } : { kind: 'live-join', code: link[2] };
  }
  const wanted = new URLSearchParams(window.location.search).get('new');
  if (wanted) window.history.replaceState(null, '', window.location.pathname);
  if (wanted === 'video') return { kind: 'video', width: 1280, height: 720, projectId: newProjectId() };
  if (wanted === 'design') return { kind: 'design', file: toFile(createDoc(1080, 1080, 'Instagram Post')), projectId: newProjectId() };
  return { kind: 'home' };
}
