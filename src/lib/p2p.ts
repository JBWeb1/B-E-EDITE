/**
 * Direct browser-to-browser connections (WebRTC) with no server of our own.
 * One side makes an invitation code, the other answers with a code; the codes are
 * swapped by QR code, link or copy-paste. After that, messages and files go
 * straight between the two devices.
 */

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const CHUNK = 60 * 1024;

// ---------- Codes ----------

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Short, URL-safe text for a connection description (compressed when the browser can). */
export async function encodeCode(desc: RTCSessionDescriptionInit): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
  if (typeof CompressionStream !== 'undefined') return 'z' + toB64(await pipe(raw, new CompressionStream('deflate-raw')));
  return 'r' + toB64(raw);
}

export async function decodeCode(code: string): Promise<RTCSessionDescriptionInit> {
  const clean = code.trim().replace(/^.*[#&](pair|live)=/, '').replace(/\s+/g, '');
  const body = fromB64(clean.slice(1));
  const raw = clean[0] === 'z' ? await pipe(body, new DecompressionStream('deflate-raw')) : body;
  const j = JSON.parse(new TextDecoder().decode(raw));
  if (j.t !== 'offer' && j.t !== 'answer') throw new Error('That is not a B-E Motion connection code.');
  return { type: j.t, sdp: j.s };
}

/** Wait until the connection details include the network addresses (or a short time has passed). */
function gathered(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function opened(channel: RTCDataChannel, ms = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (channel.readyState === 'open') return resolve();
    const timer = setTimeout(() => reject(new Error('Could not connect. Make sure both devices are online, then try again.')), ms);
    channel.addEventListener('open', () => (clearTimeout(timer), resolve()), { once: true });
  });
}

// ---------- Peer ----------

export type Message = { t: string; [key: string]: unknown };
export interface FileMeta {
  [key: string]: unknown;
}

export interface Peer {
  send(msg: Message): void;
  /** Send a file (one at a time, in order). `onProgress` gets 0..1. */
  sendFile(file: Blob, name: string, meta?: FileMeta, onProgress?: (f: number) => void): Promise<void>;
  onMessage(fn: (msg: Message) => void): () => void;
  onFile(fn: (file: File, meta: FileMeta) => void): () => void;
  /** 0..1 progress of a file being received. */
  onReceiving(fn: (name: string, fraction: number) => void): () => void;
  onClose(fn: () => void): () => void;
  close(): void;
  readonly open: boolean;
}

function wrap(pc: RTCPeerConnection, channel: RTCDataChannel): Peer {
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = 1 << 20;
  const messageFns = new Set<(m: Message) => void>();
  const fileFns = new Set<(f: File, meta: FileMeta) => void>();
  const progressFns = new Set<(name: string, f: number) => void>();
  const closeFns = new Set<() => void>();
  let incoming: { name: string; mime: string; size: number; meta: FileMeta; parts: ArrayBuffer[]; got: number } | null = null;
  const pieces = new Map<string, string[]>();
  let queue = Promise.resolve();

  const raw = (data: string | ArrayBuffer) => channel.send(data as never);
  const drain = () =>
    channel.bufferedAmount < 4 << 20
      ? Promise.resolve()
      : new Promise<void>((resolve) => channel.addEventListener('bufferedamountlow', () => resolve(), { once: true }));

  channel.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') {
      if (!incoming) return;
      incoming.parts.push(e.data as ArrayBuffer);
      incoming.got += (e.data as ArrayBuffer).byteLength;
      progressFns.forEach((fn) => fn(incoming!.name, incoming!.size ? incoming!.got / incoming!.size : 1));
      return;
    }
    let msg: Message = JSON.parse(e.data);
    // Long messages arrive in pieces.
    if (msg.t === '~part') {
      const list = pieces.get(msg.id as string) ?? [];
      list[msg.i as number] = msg.s as string;
      pieces.set(msg.id as string, list);
      if (list.filter((x) => x !== undefined).length < (msg.n as number)) return;
      pieces.delete(msg.id as string);
      msg = JSON.parse(list.join(''));
    }
    if (msg.t === '~file') {
      incoming = { name: msg.name as string, mime: msg.mime as string, size: msg.size as number, meta: (msg.meta as FileMeta) ?? {}, parts: [], got: 0 };
      progressFns.forEach((fn) => fn(incoming!.name, 0));
    } else if (msg.t === '~file-end' && incoming) {
      const file = new File(incoming.parts, incoming.name, { type: incoming.mime });
      const meta = incoming.meta;
      incoming = null;
      fileFns.forEach((fn) => fn(file, meta));
    } else messageFns.forEach((fn) => fn(msg));
  });
  const closed = () => closeFns.forEach((fn) => fn());
  channel.addEventListener('close', closed);
  pc.addEventListener('connectionstatechange', () => ['failed', 'closed'].includes(pc.connectionState) && closed());

  const sendText = (text: string) => {
    if (text.length <= CHUNK) return raw(text);
    const id = Math.random().toString(36).slice(2);
    const n = Math.ceil(text.length / CHUNK);
    for (let i = 0; i < n; i++) raw(JSON.stringify({ t: '~part', id, i, n, s: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
  };
  const listen = <T,>(set: Set<T>, fn: T) => (set.add(fn), () => void set.delete(fn));

  return {
    get open() {
      return channel.readyState === 'open';
    },
    send(msg) {
      if (channel.readyState === 'open') sendText(JSON.stringify(msg));
    },
    sendFile(file, name, meta = {}, onProgress) {
      const job = queue.then(async () => {
        sendText(JSON.stringify({ t: '~file', name, mime: file.type, size: file.size, meta }));
        for (let at = 0; at < file.size; at += CHUNK) {
          await drain();
          raw(await file.slice(at, at + CHUNK).arrayBuffer());
          onProgress?.(Math.min(1, (at + CHUNK) / file.size));
        }
        sendText(JSON.stringify({ t: '~file-end' }));
        onProgress?.(1);
      });
      queue = job.catch(() => undefined);
      return job;
    },
    onMessage: (fn) => listen(messageFns, fn),
    onFile: (fn) => listen(fileFns, fn),
    onReceiving: (fn) => listen(progressFns, fn),
    onClose: (fn) => listen(closeFns, fn),
    close() {
      channel.close();
      pc.close();
    },
  };
}

/** Make an invitation. Show `code` to the other device, then pass its answer to `accept`. */
export async function host(): Promise<{ code: string; accept: (answer: string) => Promise<Peer>; cancel: () => void }> {
  const pc = new RTCPeerConnection(ICE);
  const channel = pc.createDataChannel('bee', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = await encodeCode(pc.localDescription!);
  return {
    code,
    accept: async (answer) => {
      await pc.setRemoteDescription(await decodeCode(answer));
      await opened(channel);
      return wrap(pc, channel);
    },
    cancel: () => pc.close(),
  };
}

/** Answer an invitation. Show `answer` to the inviting device; `peer` resolves once connected. */
export async function join(code: string): Promise<{ answer: string; peer: Promise<Peer>; cancel: () => void }> {
  const pc = new RTCPeerConnection(ICE);
  const channelReady = new Promise<RTCDataChannel>((resolve) => pc.addEventListener('datachannel', (e) => resolve(e.channel), { once: true }));
  await pc.setRemoteDescription(await decodeCode(code));
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const answer = await encodeCode(pc.localDescription!);
  const peer = channelReady.then(async (channel) => {
    await opened(channel);
    return wrap(pc, channel);
  });
  return { answer, peer, cancel: () => pc.close() };
}

/** Link that opens the app on another device and answers the invitation. */
export function inviteLink(code: string, kind: 'pair' | 'live'): string {
  return `${location.href.split('#')[0].split('?')[0]}#${kind}=${code}`;
}
