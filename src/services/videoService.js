import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import wrtc from 'wrtc';

// Derive __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { RTCPeerConnection, nonstandard: { RTCVideoSource } } = wrtc;

/**
 * Spawn a worker thread to generate I420 frames of a bouncing ball.
 */
function spawnFrameWorker(frameRate) {
    const workerPath = path.resolve(__dirname, 'videoWorker.js');
    return new Worker(workerPath, { workerData: { width: 640, height: 480, frameRate } });
}

/**
 * Rewrite SDP to prefer H.264 codec in m=video line.
 */
function preferH264(sdp) {
    const lines = sdp.split('\r\n');
    const mIndex = lines.findIndex(l => l.startsWith('m=video'));
    if (mIndex === -1) return sdp;
    // Collect payload types for H264
    const h264Pts = lines
        .filter(l => l.startsWith('a=rtpmap') && l.includes('H264/90000'))
        .map(l => l.match(/a=rtpmap:(\d+)/)[1]);
    if (!h264Pts.length) return sdp;
    const parts = lines[mIndex].split(' ');
    const header = parts.slice(0, 3);
    const others = parts.slice(3).filter(pt => !h264Pts.includes(pt));
    lines[mIndex] = [...header, ...h264Pts, ...others].join(' ');
    return lines.join('\r\n');
}

/**
 * Handle WebRTC signalling. Enforces H.264 in both offer and answer.
 */
export function handleSignaling(socket, frameRate = 10) {
    socket.on('sdp-offer', async ({ sdp, type }) => {
        console.log('Received SDP offer');

        // Setup connection and track
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        const videoSource = new RTCVideoSource();
        pc.addTrack(videoSource.createTrack());

        // ICE exchange
        pc.onicecandidate = ({ candidate }) => candidate && socket.emit('ice-candidate', candidate);
        socket.on('ice-candidate', async cand => { try { await pc.addIceCandidate(cand); } catch { } });

        // Apply H.264 preference to client offer
        const offerSDP = preferH264(sdp);
        await pc.setRemoteDescription({ type, sdp: offerSDP });

        // Create and rewrite answer to prefer H264
        let answer = await pc.createAnswer();
        answer.sdp = preferH264(answer.sdp);
        await pc.setLocalDescription(answer);
        socket.emit('sdp-answer', { type: answer.type, sdp: answer.sdp });
        console.log('Sent SDP answer (H264 enforced)');

        // Spawn worker
        const worker = spawnFrameWorker(frameRate);
        let truePos = { x: null, y: null };
        worker.on('message', ({ i420Buffer, timestamp, ballX, ballY }) => {
            truePos = { x: ballX, y: ballY };
            videoSource.onFrame({ format: 'I420', width: 640, height: 480, data: new Uint8Array(i420Buffer), timestamp });
            socket.emit('debug', `Frame sent, length=${i420Buffer.byteLength}`);
        });

        // Error feedback loop
        socket.on('ball-coords', ({ x, y }) => {
            if (truePos.x !== null) {
                const err = Math.hypot(x - truePos.x, y - truePos.y);
                socket.emit('error-value', { error: err });
            }
        });

        socket.on('disconnect', () => worker.terminate());
    });
}
