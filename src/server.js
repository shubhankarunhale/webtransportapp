import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import express from "express";
import { Http3Server } from "@fails-components/webtransport";
import { attachSignalling } from "./controllers/signalling.js";

async function main() {
    // load TLS certs
    const key = await readFile("./certs/key.pem");
    const cert = await readFile("./certs/cert.pem");

    // 1) Express app to serve static client
    const app = express();
    app.use(express.static("public"));

    // 2) HTTPS server
    const httpsServer = createServer({ key, cert }, app);
    httpsServer.listen(3000, () => console.log("HTTPS listening on https://127.0.0.1:3000"));

    // 3) Socket.IO WebTransport signalling
    const io = attachSignalling(httpsServer);

    // 4) HTTP/3 → WebTransport bridge
    const h3 = new Http3Server({ host: "0.0.0.0", port: 3000, secret: "changeit", cert, privKey: key });
    h3.startServer();

    const sessionReader = (await h3.sessionStream("/socket.io/")).getReader();
    while (true) {
        const { done, value } = await sessionReader.read();
        if (done) break;
        io.engine.onWebTransportSession(value);
    }
}

main().catch(console.error);
