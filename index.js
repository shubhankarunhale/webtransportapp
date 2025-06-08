import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { Server } from "socket.io";
import { Http3Server } from "@fails-components/webtransport";
import wrtc from "wrtc";

const { RTCPeerConnection, nonstandard } = wrtc;
const { RTCVideoSource } = nonstandard;

async function main() {
    // Load TLS certificates
    const key = await readFile("key.pem");
    const cert = await readFile("cert.pem");

    // HTTPS server to serve the HTML client
    const httpsServer = createServer({ key, cert }, async (req, res) => {
        if (req.method === "GET" && req.url === "/") {
            const html = await readFile("./index.html");
            res.writeHead(200, { "Content-Type": "text/html" });
            return res.end(html);
        }
        res.writeHead(404).end();
    });
    httpsServer.listen(3000);
    console.log("HTTPS listening on https://127.0.0.1:3000");

    // Socket.IO server supporting WebTransport
    const io = new Server(httpsServer, { transports: ["polling", "websocket", "webtransport"] });

    io.on("connection", socket => {
        console.log("Client connected via", socket.conn.transport.name);
        socket.conn.on("upgrade", t => console.log("Upgraded to", t.name));

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
    });

    // WebTransport session forwarding from HTTP/3
    const h3 = new Http3Server({
        host: "0.0.0.0",
        port: 3000,
        secret: "changeit",
        cert,
        privKey: key
    });
    h3.startServer();

    const reader = (await h3.sessionStream("/socket.io/")).getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        io.engine.onWebTransportSession(value);
    }
}

main().catch(console.error);
