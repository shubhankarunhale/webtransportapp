import { fetchPythonAnswer } from '../controllers/pythonBridge.js';
import { fetchTruePosition } from '../controllers/pythonBridge.js';

/**
 * Handle WebRTC signalling: relay SDP offers to Python service and return answers.
 */
export function handleSignaling(socket, frameRate = 60) {
    socket.on('sdp-offer', async ({ sdp, type }) => {
        console.log('Received SDP offer');

        // Forward offer to Python media service
        const payload = { type, sdp, width: 640, height: 480, frame_rate: frameRate };
        try {
            const answer = await fetchPythonAnswer(payload);
            // Send answer back to client
            socket.emit('sdp-answer', { type: answer.type, sdp: answer.sdp });
            console.log('Relayed SDP answer from Python');
        } catch (err) {
            console.error('Error negotiating with Python media service:', err);
            socket.emit('sdp-error', { message: err.message });
        }
    });
    socket.on('ball-coords', async ({ x, y }) => {
        try {
            const { x: trueX, y: trueY } = await fetchTruePosition();
            const err = Math.hypot(x - trueX, y - trueY);
            socket.emit('error-value', { error: err });
        } catch (e) {
            console.error('Error fetching true position:', e);
        }
    })
}

