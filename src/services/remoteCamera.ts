import Peer, { MediaConnection } from 'peerjs';

export interface RemoteCameraSession {
  getPeerId: () => string;
  waitForController: (controllerId: string, stream: MediaStream) => Promise<void>;
  startController: (onStream: (stream: MediaStream) => void) => Promise<string>;
  stop: () => void;
}

const PEER_OPEN_TIMEOUT_MS = 15_000;
const MEDIA_CONNECT_TIMEOUT_MS = 25_000;

function waitForPeerOpen(nextPeer: Peer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(new Error('Peer signaling connection timed out. Check internet access and retry.')), PEER_OPEN_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      nextPeer.off('open', onOpen);
      nextPeer.off('error', onError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onOpen = () => finish();
    const onError = (error: Error) => finish(error);

    nextPeer.on('open', onOpen);
    nextPeer.on('error', onError);
    // Handle the unlikely case where the peer opened before listeners attached.
    if (nextPeer.open && nextPeer.id) finish();
  });
}

function waitForMediaConnection(connection: MediaConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    const pc = connection.peerConnection;
    let settled = false;
    const timeoutId = window.setTimeout(
      () => finish(new Error('Phone could not establish a WebRTC media connection to the laptop within 25 seconds. Keep both devices online and retry.')),
      MEDIA_CONNECT_TIMEOUT_MS
    );

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      pc.removeEventListener('connectionstatechange', onConnectionStateChange);
      connection.off('error', onError);
      connection.off('close', onClose);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onConnectionStateChange = () => {
      if (pc.connectionState === 'connected') finish();
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        finish(new Error(`WebRTC media connection ${pc.connectionState}. Reopen the phone camera link and retry.`));
      }
    };
    const onError = (error: Error) => finish(error);
    const onClose = () => finish(new Error('Laptop closed the camera connection.'));

    pc.addEventListener('connectionstatechange', onConnectionStateChange);
    connection.on('error', onError);
    connection.on('close', onClose);
    onConnectionStateChange();
  });
}

export function createRemoteCameraSession(): RemoteCameraSession {
  let peer: Peer | null = null;
  let call: MediaConnection | null = null;

  return {
    getPeerId: () => peer?.id || '',

    waitForController: async (controllerId, stream) => {
      peer?.destroy();
      peer = new Peer();
      await waitForPeerOpen(peer);

      const outgoing = peer.call(controllerId, stream);
      if (!outgoing) {
        throw new Error('Unable to start the phone-to-laptop media call. Check the pairing link and retry.');
      }
      call = outgoing;
      outgoing.on('close', () => {
        if (call === outgoing) call = null;
      });
      await waitForMediaConnection(outgoing);
    },

    startController: async (onStream) => {
      peer?.destroy();
      peer = new Peer();

      // Register the call handler before awaiting peer-open. This avoids a race
      // where the phone calls immediately after the peer opens but before the
      // laptop has subscribed to incoming calls.
      peer.on('call', (incoming) => {
        call?.close();
        call = incoming;

        // Subscribe before answering so the first incoming stream cannot be missed.
        incoming.on('stream', onStream);
        incoming.on('error', (error) => {
          console.error('Incoming phone media call failed:', error);
        });
        incoming.on('close', () => {
          if (call === incoming) call = null;
        });
        incoming.answer();
      });

      await waitForPeerOpen(peer);
      return peer.id;
    },

    stop: () => {
      call?.close();
      peer?.destroy();
      call = null;
      peer = null;
    },
  };
}
