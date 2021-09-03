import * as helpers from './helpers';
import * as socketIo from 'socket.io';
import * as socketIoRedis from 'socket.io-redis';
// import * as socketIoSticky from '@socket.io/sticky';
import Redis from 'ioredis';
import RedisSessionStore from './sessionStore';
import { createServer } from 'http';
import faker from 'faker';
import { logger } from './globals';
import { sample } from 'lodash';

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

/*
 * Dev-only chat reply simulator.
 */
if (process.env.NODE_ENV !== 'production') {
  io.on('connection', async (socket) => {
    socket.on('message', async ({ roomId }) => {
      await simulateReply(socket, roomId);
    });
  });
}

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
   * Resets the unread count for the given room.
   */
  socket.on('reset unread', async ({ roomId }) => {
    await sessionStore.resetUnreadCount(socket.ipHash, roomId);
    logger.debug(
      `IP ${socket.ipHash.slice(
        -6
      )} reset unread message count for room ${roomId}`
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
    if (message) {
      socket.to(roomId).emit('incr total unread', { roomId, count: 1 });
      socket.to(roomId).emit('incr unread', { roomId, count: 1 });
      socket.to(roomId).emit('message', message);
      socket.emit('message', { ...message, from: null });
      logger.debug(
        `IP ${socket.ipHash.slice(-6)} sent a message to room ${roomId}`
      );
    }
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

/*
 * Dev-only method to simulate a chat reply.
 */
async function simulateReply(
  socket: socketIo.Socket,
  roomId: string
): Promise<void> {
  try {
    const keys = (
      await sessionStore.scanKeys(`room:${roomId}:ip:*:data`)
    ).filter((key) => !key.includes(socket.ipHash));
    const key = sample(keys) as string;

    const ipHash = key?.split(':')[3];
    const authorId = await sessionStore.redisClient.hget(key, 'authorId');

    if (!ipHash || !authorId) {
      // Something went wrong. Who cares.
      return;
    }

    socket.emit('user connected', { roomId, authorId });
    const messages = Array.from({ length: random(1, 4) });

    let timeout = 0;
    for (let i = 1; i <= messages.length; i++) {
      timeout = (timeout || 0) + Math.round(Math.random() * 5000);
      setTimeout(async () => {
        const message = await sessionStore.saveMessage({
          roomId,
          content: faker.lorem.sentence(),
          ipHash,
        });
        socket.emit('incr total unread', { roomId, count: 1 });
        socket.emit('incr unread', { roomId, count: 1 });
        socket.emit('message', message);
      }, timeout);
    }
    setTimeout(() => {
      socket.emit('user disconnected', { roomId, authorId });
    }, timeout + 5000);
  } catch (error) {
    logger.error(`Error simulating chat reply. ${error}`);
  }
}

/*
 * Returns a random whole number (min <= n < max) in the given range.
 */
function random(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min);
}
