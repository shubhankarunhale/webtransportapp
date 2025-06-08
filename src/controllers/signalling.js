import { Server as IOServer } from 'socket.io';
import { handleSignaling } from '../services/videoService.js';

export function attachSignalling(server) {
    const io = new IOServer(server, { transports: ['polling', 'websocket', 'webtransport'] });
    io.on('connection', socket => {
        console.log('Client via', socket.conn.transport.name);
        socket.conn.on('upgrade', t => console.log('Upgraded to', t.name));
        handleSignaling(socket);
    });
    return io;
}
