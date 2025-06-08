import wrtc from 'wrtc';
const { RTCPeerConnection, nonstandard: { RTCVideoSource } } = wrtc;

export function handleSignaling(socket) {
    socket.on("sdp-offer", async ({ sdp, type }) => {
        console.log("Received SDP offer");

        // PeerConnection setup with STUN and synthetic video track
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        const videoSource = new RTCVideoSource();
        pc.addTrack(videoSource.createTrack());

        // ICE candidate exchange
        pc.onicecandidate = ({ candidate }) => {
            if (candidate) socket.emit("ice-candidate", candidate);
        };
        socket.on("ice-candidate", async candidate => {
            try { await pc.addIceCandidate(candidate); } catch { }
        });

        // SDP negotiation
        await pc.setRemoteDescription({ sdp, type });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("sdp-answer", { sdp: answer.sdp, type: answer.type });
        console.log("Sent SDP answer");

        const width = 640;
        const height = 480;
        const ySize = width * height;
        const uvSize = (width >> 1) * (height >> 1);
        const i420Array = new Uint8Array(ySize + 2 * uvSize);
        i420Array.fill(128, 0, ySize);
        i420Array.fill(128, ySize, ySize + uvSize);
        i420Array.fill(128, ySize + uvSize, ySize + 2 * uvSize);


        setInterval(() => {
            videoSource.onFrame({
                format: 'I420',
                width,
                height,
                data: i420Array,
                timestamp: Date.now() * 1000
            });
            socket.emit('debug', `sent I420 frame length=${i420Array.length}`);
        }, 100);
    });

}