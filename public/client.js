const log = msg => { document.getElementById('log').textContent += msg + '\n'; };
const $status = document.getElementById('status');
const $transport = document.getElementById('transport');

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
        const ctx = canvas.getContext('2d');

        (async function readFrame() {
            const { value: frame, done } = await reader.read();
            if (done) return;
            const bitmap = await createImageBitmap(frame);
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close(); frame.close();
            readFrame();
        })();
    }
};

socket.on('sdp-answer', async ({ sdp, type }) => {
    log('Received SDP answer');
    await pc.setRemoteDescription({ sdp, type });
});

document.getElementById('start').onclick = async () => {
    log('Creating SDP offer');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log('Sending SDP offer');
    socket.emit('sdp-offer', { sdp: offer.sdp, type: offer.type });

    const videoEl = document.getElementById('remote');
    try {
        await videoEl.play();
        log('video.play() succeeded from click');
    } catch (e) {
        log(`video.play() failed in click: ${e.message}`);
    }
};