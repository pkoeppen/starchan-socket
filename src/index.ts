import * as helpers from './helpers';
import * as socketIo from 'socket.io';
import * as socketIoRedis from 'socket.io-redis';
import * as socketIoSticky from '@socket.io/sticky';
import Redis from 'ioredis';
import RedisMessageStore from './messageStore';
import RedisSessionStore from './sessionStore';
import { createServer } from 'http';

const httpServer = createServer();
const redisClient = new Redis();
const io = new socketIo.Server(httpServer, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://mod.localhost:3000',
      'http://local.starchan.org:3000',
      'http://mod.local.starchan.org:3000',
    ],
  },
  adapter: socketIoRedis.createAdapter({
    pubClient: redisClient,
    subClient: redisClient.duplicate(),
  }),
});

const sessionStore = new RedisSessionStore(redisClient);
const messageStore = new RedisMessageStore(redisClient);

// Extend the base socket.io typings.
declare module 'socket.io' {
  class Socket {
    ipHash: string;
    sessionId: string;
    boardId: string;
  }
}

// Middleware to fetch existing session, or create a new one.
io.use(async (socket, next) => {
  const sessionId = socket.handshake.auth.sessionId;
  if (sessionId) {
    const session = await sessionStore.findSession(sessionId);
    if (session) {
      socket.sessionId = sessionId;
      socket.boardId = session.boardId;
      return next();
    }
  }
  const boardId = socket.handshake.auth.boardId;
  const ipAddress = socket.handshake.address;
  socket.ipHash = helpers.encrypt(ipAddress);
  socket.sessionId = helpers.randomId();
  socket.boardId = boardId;
  next();
});

io.on('connection', async (socket) => {
  // Persist the session.
  sessionStore.saveSession(socket.sessionId, {
    ipHash: socket.ipHash,
    connected: true.toString(),
  });

  // Emit session details.
  socket.emit('session', {
    ipHash: socket.ipHash,
    sessionId: socket.sessionId,
  });

  // Join the "ipHash" room.
  socket.join(socket.ipHash);

  // Fetch other users with whom I've started a conversation.
  const [messages, sessions] = await Promise.all([
    messageStore.findMessagesForUser(socket.sessionId),
    sessionStore.findAllSessions(),
  ]);
  const messagesPerUser = new Map();
  for (const message of messages) {
    const { from, to } = message;
    const otherUser = socket.ipHash === from ? to : from;
    if (messagesPerUser.has(otherUser)) {
      messagesPerUser.get(otherUser).push(message);
    } else {
      messagesPerUser.set(otherUser, [message]);
    }
  }

  const users = [];
  for (const session of sessions) {
    users.push({
      userID: session.userID,
      username: session.username,
      connected: session.connected,
      messages: messagesPerUser.get(session.userID) || [],
    });
  }
  socket.emit('users', users);

  // notify existing users
  socket.broadcast.emit('user connected', {
    userID: socket.userID,
    username: socket.username,
    connected: true,
    messages: [],
  });

  // forward the private message to the right recipient (and to other tabs of the sender)
  socket.on('private message', ({ content, to }) => {
    const decrypted = helpers.decrypt(authorId);
    const [ipAddress, threadId] = decrypted;
    const message = {
      content,
      from: socket.ipHash,
      to__boardId,
      to__threadId,
      to__authorId,
    };
    socket.to(to).to(socket.userID).emit('private message', message);
    messageStore.saveMessage(message);
  });

  // notify users upon disconnection
  socket.on('disconnect', async () => {
    const matchingSockets = await io.in(socket.userID).allSockets();
    const isDisconnected = matchingSockets.size === 0;
    if (isDisconnected) {
      // notify other users
      socket.broadcast.emit('user disconnected', socket.userID);
      // update the connection status of the session
      sessionStore.saveSession(socket.sessionId, {
        userID: socket.userID,
        username: socket.username,
        connected: false,
      });
    }
  });
});

socketIoSticky.setupWorker(io);
