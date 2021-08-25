import * as helpers from './helpers';
import * as socketIo from 'socket.io';
import * as socketIoRedis from 'socket.io-redis';
// import * as socketIoSticky from '@socket.io/sticky';
import Redis from 'ioredis';
import RedisSessionStore from './sessionStore';
import { createServer } from 'http';
import { logger } from './globals';

const httpServer = createServer();
const redisClient = new Redis({
  host: 'redis', // Docker Compose host.
  port: 6379,
});
const io = new socketIo.Server(httpServer, {
  path: '/',
  adapter: socketIoRedis.createAdapter({
    pubClient: redisClient,
    subClient: redisClient.duplicate(),
  }),
});

const sessionStore = new RedisSessionStore(redisClient);

// Extend the base socket.io typings.
declare module 'socket.io' {
  interface Socket {
    ipAddress: string;
    ipHash: string;
    myRooms: { roomId: string; myAuthorId: string }[];
    boardId: string;
  }
}

// Middleware to set the IP hash and mark the user as online.
io.use(async (socket, next) => {
  let ipAddress =
    (socket.handshake.headers['x-real-ip'] as string) ||
    socket.handshake.address;
  if (ipAddress === '::1') {
    ipAddress = '127.0.0.1';
  } else if (ipAddress.includes(':')) {
    // If this is an address like ::ffff:1.2.3.4, get the IPv4 address.
    ipAddress = ipAddress.split(':').pop() as string;
  }
  socket.ipAddress = ipAddress;
  socket.ipHash = helpers.encrypt(ipAddress);
  await sessionStore.setOnline(socket.ipHash);
  const rooms = await sessionStore.listRooms(socket.ipHash);
  socket.myRooms = rooms;
  next();
});

io.on('connection', async (socket) => {
  logger.debug(
    `New connection from IP ${socket.ipAddress} (${socket.ipHash.slice(-6)})`
  );

  // Join "ipHash" room.
  socket.join(socket.ipHash);

  // Join each room of which this IP is a member.
  for (const { roomId, myAuthorId } of socket.myRooms) {
    socket.join(roomId);
    socket.to(roomId).emit('user connected', { roomId, authorId: myAuthorId });
    logger.debug(`IP ${socket.ipHash.slice(-6)} joined room ${roomId}`);
  }

  /*
   * Refreshes the socket's room list.
   */
  socket.on('refresh', async () => {
    const rooms = await sessionStore.listRooms(socket.ipHash);
    socket.myRooms = rooms;
    logger.debug(`IP ${socket.ipHash.slice(-6)} refreshed room list`);
  });

  /*
   * Returns total unread message count.
   */
  socket.on('total unread', async () => {
    const count = await sessionStore.getTotalUnreadCount(socket.ipHash);
    socket.emit('total unread', { count });
    logger.debug(
      `IP ${socket.ipHash.slice(-6)} fetched total unread message count`
    );
  });

  /*
   * Returns a list of rooms.
   */
  socket.on('rooms', async () => {
    const rooms = await sessionStore.getRooms(socket.ipHash, socket.myRooms);
    socket.emit('rooms', rooms);
    logger.debug(
      `IP ${socket.ipHash.slice(-6)} fetched room data (${rooms.length})`
    );
  });

  /*
   * Returns messages for the given room.
   */
  socket.on('messages', async (roomId) => {
    if (!(await sessionStore.inRoom(socket.ipHash, roomId))) {
      socket.emit('messages', []);
      return;
    }
    const messages = await sessionStore.getMessages(socket.ipHash, roomId);
    socket.emit('messages', messages);
    await sessionStore.resetUnreadCount(socket.ipHash, roomId);
    const count = await sessionStore.getTotalUnreadCount(socket.ipHash);
    socket.emit('reset unread', { roomId });
    socket.emit('total unread', { count });
    logger.debug(
      `IP ${socket.ipHash.slice(-6)} fetched messages for room ${roomId}`
    );
  });

  /*
   * Adds a new message to the given room.
   */
  socket.on('message', async ({ roomId, content }) => {
    const message = await sessionStore.saveMessage({
      roomId,
      content,
      ipHash: socket.ipHash,
    });
    socket.to(roomId).emit('incr total unread', { roomId, count: 1 });
    socket.to(roomId).emit('incr unread', { roomId, count: 1 });
    socket.to(roomId).emit('message', message);
    socket.emit('message', { ...message, from: null });
    logger.debug(
      `IP ${socket.ipHash.slice(-6)} sent a message to room ${roomId}`
    );
  });

  /*
   * Handles user disconnect.
   */
  socket.on('disconnect', async () => {
    // Check if user has any other open sessions.
    const matchingSockets = await io.in(socket.ipHash).allSockets();
    const isDisconnected = matchingSockets.size === 0;
    if (isDisconnected) {
      // Emit disconnect event to all rooms this user is in.
      for (const { roomId, myAuthorId } of socket.myRooms) {
        socket
          .to(roomId)
          .emit('user disconnected', { roomId, authorId: myAuthorId });
      }
      await sessionStore.setOffline(socket.ipHash);
    }
  });
});

// socketIoSticky.setupWorker(io);

const PORT = 3002;
httpServer.listen(PORT, () =>
  logger.info(`Listening at http://localhost:${PORT}`)
);
