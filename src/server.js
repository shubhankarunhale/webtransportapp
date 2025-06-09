import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import express from "express";
import { Http3Server } from "@fails-components/webtransport";
import { attachSignalling } from "./controllers/signalling.js";

async function main() {
    // Load TLS certificates
    const key = await readFile("./certs/key.pem");
    const cert = await readFile("./certs/cert.pem");

    const app = express();
    app.use(express.static("public"));

    const httpsServer = createServer({ key, cert }, app);
    httpsServer.listen(3000, () =>
        console.log("HTTPS listening on https://127.0.0.1:3000")
    );

    const io = attachSignalling(httpsServer);

    // Start WebTransport HTTP/3 server
    const h3 = new Http3Server({
        host: "0.0.0.0",
        port: 3000,
        secret: "changeit",
        cert,
        privKey: key
    });
    h3.startServer();

    // Handle WebTransport sessions
    const sessionReader = (await h3.sessionStream("/socket.io/")).getReader();
    (async function pump() {
        for (; ;) {
            const { done, value } = await sessionReader.read();
            if (done) break;
            io.engine.onWebTransportSession(value);
        }
    })();

    // Graceful shutdown
    const shutdown = async (signal) => {
        console.log(`\nReceived ${signal}, shutting down...`);
        await new Promise(res => httpsServer.close(res));
        console.log("HTTPS server closed");

        io.close(() => console.log("Socket.IO closed"));

        await h3.stopServer();
        console.log("HTTP/3 WebTransport bridge stopped");

        process.exit(0);
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
