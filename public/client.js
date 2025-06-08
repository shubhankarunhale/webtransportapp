// Utility to prefer H264 codec in SDP
function preferH264(sdp) {
    const lines = sdp.split('\r\n');
    const mLineIndex = lines.findIndex(line => line.startsWith('m=video'));
    if (mLineIndex === -1) return sdp;
    // Find payload types that map to H264
    const h264Payloads = lines
        .filter(line => line.startsWith('a=rtpmap') && line.includes('H264/90000'))
        .map(line => line.match(/a=rtpmap:(\d+)/)[1]);
    if (!h264Payloads.length) return sdp;
    const parts = lines[mLineIndex].split(' ');
    const header = parts.slice(0, 3);
    const others = parts.slice(3).filter(pt => !h264Payloads.includes(pt));
    lines[mLineIndex] = [...header, ...h264Payloads, ...others].join(' ');
    return lines.join('\r\n');
}

const log = msg => { document.getElementById('log').textContent += msg + '\n'; };
const $status = document.getElementById('status');
const $transport = document.getElementById('transport');
const $error = document.getElementById('error'); // DOM element to display error

const socket = io('https://127.0.0.1:3000', { transports: ['webtransport'] });
socket.on('connect', () => {
    $status.textContent = 'Connected';
    $transport.textContent = socket.io.engine.transport.name;
    log(`Connected via ${socket.io.engine.transport.name}`);
});
socket.on('disconnect', reason => {
    $status.textContent = 'Disconnected';
    $transport.textContent = 'N/A';
    log(`Disconnected: ${reason}`);
});
socket.on('debug', msg => log(`Debug: ${msg}`));

const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

console.log(
    'RTCRtpSender Capabilities (video):',
    RTCRtpSender.getCapabilities('video').codecs.map(c => c.mimeType)
);
pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
        socket.emit('ice-candidate', candidate);
        log('Sent ICE candidate');
    }
};
socket.on('ice-candidate', async candidate => {
    await pc.addIceCandidate(candidate);
    log('Added remote ICE candidate');
});

pc.addTransceiver('video', { direction: 'recvonly' });

pc.ontrack = event => {
    const videoEl = document.getElementById('remote');
    const track = event.track;
    const stream = new MediaStream([track]);
    videoEl.srcObject = stream;
    log('Remote track added via direct track');

    if (videoEl.paused) {
        videoEl.play().then(() => log('video.play() succeeded')).catch(e => log(`video.play() failed: ${e.message}`));
    }

    if (window.MediaStreamTrackProcessor) {
        const processor = new MediaStreamTrackProcessor({ track });
        const reader = processor.readable.getReader();

        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        canvas.style.display = 'block';
        canvas.style.marginTop = '1rem';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); // optimize readbacks

        async function readFrame() {
            const { value: frame, done } = await reader.read();
            if (done) return;
            const bitmap = await createImageBitmap(frame);
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close(); frame.close();

            // Track the ball center and send coordinates
            const coords = trackBall(canvas, ctx);
            socket.emit('ball-coords', coords);
            log(`Sent ball coords: x=${coords.x.toFixed(1)}, y=${coords.y.toFixed(1)}`);

            readFrame();
        }
        readFrame();
    }
};

// Listen for error feedback
socket.on('error-value', ({ error }) => {
    if (error != null) {
        if ($error) $error.textContent = `Tracking error: ${error.toFixed(2)} pixels`;
        log(`Received error: ${error.toFixed(2)}`);
    }
});

// Handle SDP answer
socket.on('sdp-answer', async ({ sdp, type }) => {
    log('Received SDP answer');
    await pc.setRemoteDescription({ sdp, type });
});

// Start button: create offer preferring H264
document.getElementById('start').onclick = async () => {
    log('Creating SDP offer');
    let offer = await pc.createOffer();
    const modifiedSdp = preferH264(offer.sdp);
    await pc.setLocalDescription({ type: offer.type, sdp: modifiedSdp });
    log('Sending SDP offer (H264 preferred)');
    socket.emit('sdp-offer', { sdp: modifiedSdp, type: offer.type });

    const videoEl = document.getElementById('remote');
    try {
        await videoEl.play();
        log('video.play() succeeded from click');
    } catch (e) {
        log(`video.play() failed in click: ${e.message}`);
    }
};

/**
 * Simple ball-tracking by brightness threshold and centroid calculation.
 */
function trackBall(canvas, ctx) {
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    let sumX = 0, sumY = 0, count = 0;
    const data = imageData.data;
    const threshold = 200;
    for (let i = 0; i < data.length; i += 4) {
        const brightness = data[i] + data[i + 1] + data[i + 2];
        if (brightness > threshold * 3) {
            const idx = i / 4;
            const x = idx % width;
            const y = Math.floor(idx / width);
            sumX += x;
            sumY += y;
            count++;
        }
    }
    if (count === 0) return { x: width / 2, y: height / 2 };
    return { x: sumX / count, y: sumY / count };
}
