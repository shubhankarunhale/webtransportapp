import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import express from "express";
import { Http3Server } from "@fails-components/webtransport";
import { attachSignalling } from "./controllers/signalling.js";

async function main() {
    // 1) Load certs
    const key = await readFile("./certs/key.pem");
    const cert = await readFile("./certs/cert.pem");

    // 2) Express app for static client
    const app = express();
    app.use(express.static("public"));

    // 3) HTTPS server
    const httpsServer = createServer({ key, cert }, app);
    httpsServer.listen(3000, () =>
        console.log("HTTPS listening on https://127.0.0.1:3000")
    );

    // 4) Socket.IO signalling
    const io = attachSignalling(httpsServer);

    // 5) HTTP/3 → WebTransport bridge
    const h3 = new Http3Server({
        host: "0.0.0.0",
        port: 3000,
        secret: "changeit",
        cert,
        privKey: key
    });
    h3.startServer();

    // 6) Pump sessions into Socket.IO
    const sessionReader = (await h3.sessionStream("/socket.io/")).getReader();
    (async function pump() {
        for (; ;) {
            const { done, value } = await sessionReader.read();
            if (done) break;
            io.engine.onWebTransportSession(value);
        }
    })();

    // --------------------------------------------------------------
    // 7) Graceful shutdown handlers
    const shutdown = async (signal) => {
        console.log(`\nReceived ${signal}, shutting down...`);
        // Stop accepting new connections
        await new Promise(res => httpsServer.close(res));
        console.log("HTTPS server closed");

        // Close Socket.IO
        io.close(() => console.log("Socket.IO closed"));

        // Stop HTTP/3 server
        await h3.stopServer();
        console.log("HTTP/3 WebTransport bridge stopped");

        // Finally exit
        process.exit(0);
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
