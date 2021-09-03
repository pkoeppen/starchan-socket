import { Redis } from 'ioredis';
import { logger } from './globals';
import { sortBy } from 'lodash';

const SESSION_TTL = 60 * 60 * 24; // 24 hours.
const MESSAGE_TTL = 60 * 10; // 10 minutes.

interface RoomData {
  id: string;
  boardId: string;
  threadId: string;
  myAuthorId: string;
  participants: { authorId: string; online: boolean }[];
  unread: number;
}

interface Message {
  roomId: string;
  from: string;
  content: string;
  createdAt: number;
}
export default class RedisSessionStore {
  redisClient: Redis;
  constructor(redisClient: Redis) {
    this.redisClient = redisClient;
  }

  // public async flush(): Promise<void> {
  //   await this.redisClient.flushall();
  // }

  // public async createRooms(ipHash: string): Promise<string[]> {
  //   try {
  //     await this.redisClient.flushall();

  //     const rooms = Array.from({ length: 10 }).map(() =>
  //       crypto.randomBytes(32).toString('hex').slice(-6)
  //     );
  //     const ipHashes = Array.from({ length: 10 }).map(() =>
  //       crypto.randomBytes(32).toString('hex')
  //     );
  //     const boards = ['b', 'gif', 'x'];
  //     const multi = this.redisClient.multi();

  //     for (const roomId of rooms) {
  //       const partner = ipHashes[0];
  //       // Set room data.
  //       multi.hmset(`room:${roomId}:data`, {
  //         id: roomId,
  //         boardId: boards[Math.floor(Math.random() * boards.length)],
  //         threadId: Math.round(Math.random() * 999999999),
  //       });

  //       // Set IP data.
  //       multi.hmset(`room:${roomId}:ip:${ipHash}:data`, {
  //         ipHash,
  //         authorId: helpers.encrypt(ipHash),
  //       });
  //       multi.hmset(`room:${roomId}:ip:${partner}:data`, {
  //         ipHash: partner,
  //         authorId: helpers.encrypt(partner),
  //       });

  //       // Set unread messages count.
  //       multi.set(
  //         `room:${roomId}:ip:${ipHash}:unread`,
  //         Math.round(Math.random() * 10)
  //       );
  //       multi.set(`room:${roomId}:ip:${partner}:unread`, 0);

  //       // Add dummy messages.
  //       const messages = generateMessageSet();
  //       let now = Date.now();
  //       for (const { content, fromSelf } of messages) {
  //         now += Math.round(Math.random() * 100000);
  //         multi.hmset(`room:${roomId}:message:${now}:data`, {
  //           from: helpers.encrypt(fromSelf ? ipHash : partner),
  //           content,
  //           createdAt: now,
  //         });
  //       }
  //     }

  //     multi.set(`ip:${ipHash}:online`, 1);
  //     for (const _ipHash of ipHashes) {
  //       multi.set(`ip:${_ipHash}:online`, Math.round(Math.random()));
  //     }

  //     // Execute.
  //     await multi.exec();
  //   } catch (error) {
  //     logger.error(`Error creating rooms. ${error}`);
  //   }
  //   return [];
  // }

  /*
   * Sets the user as "online" and returns the unread message count.
   */
  public async setOnline(ipHash: string): Promise<void> {
    try {
      await this.redisClient
        .multi()
        .set(`ip:${ipHash}:online`, 1)
        .expire(`ip:${ipHash}:online`, SESSION_TTL)
        .exec();
      logger.debug(`Set IP ${ipHash.slice(-6)} online`);
    } catch (error) {
      logger.error(`Error setting IP ${ipHash.slice(-6)} online. ${error}`);
    }
  }

  /*
   * Sets the user as "offline".
   */
  public async setOffline(ipHash: string): Promise<void> {
    try {
      await this.redisClient.del(`ip:${ipHash}:online`);
      logger.debug(`Set IP ${ipHash.slice(-6)} offline`);
    } catch (error) {
      logger.error(`Error setting IP ${ipHash.slice(-6)} offline. ${error}`);
    }
  }

  /*
   * Lists the rooms in which this IP is active.
   */
  public async listRooms(
    ipHash: string
  ): Promise<{ roomId: string; myAuthorId: string }[]> {
    try {
      // Get unread message count key for each room.
      const keys = await this.scanKeys(`room:*:ip:${ipHash}:data`);
      const rooms = keys.map((key) => key.split(':')[1]);

      logger.debug(`Rooms found for IP ${ipHash.slice(-6)}: ${rooms.length}`);

      const multi = this.redisClient.multi();
      for (const roomId of rooms) {
        multi.hget(`room:${roomId}:ip:${ipHash}:data`, 'authorId');
      }
      const results = await multi.exec();
      return rooms.map((roomId, i) => {
        return {
          roomId,
          myAuthorId: results[i].pop() as string,
        };
      });
    } catch (error) {
      logger.error(`Error listing rooms. ${error}`);
      return [];
    }
  }

  /*
   * Gets the total unread message count.
   */
  public async getTotalUnreadCount(ipHash: string): Promise<number> {
    try {
      // Get unread message count key for each room.
      const keys = await this.scanKeys(`room:*:ip:${ipHash}:unread`);
      logger.debug(`Rooms found for IP ${ipHash.slice(-6)}: ${keys.length}`);
      const multi = this.redisClient.multi();
      for (const key of keys) {
        multi.get(key);
      }

      // Execute multi.
      const results = await multi.exec();

      // Calculate total unread messages count.
      let unreadCount = 0;
      for (const [error, count] of results) {
        unreadCount += parseInt(count) || 0;
      }
      return unreadCount;
    } catch (error) {
      logger.error(`Error getting total unread message count. ${error}`);
    }
    return 0;
  }

  /*
   * Sets the unread message count for the given room to zero.
   */
  public async resetUnreadCount(
    ipHash: string,
    roomId: string
  ): Promise<number> {
    try {
      await this.redisClient.set(`room:${roomId}:ip:${ipHash}:unread`, 0);
    } catch (error) {
      logger.error(`Error resetting total unread message count. ${error}`);
    }
    return 0;
  }

  /*
   * Gets the room data and participants for each of the given rooms.
   */
  public async getRooms(
    ipHash: string,
    rooms: { roomId: string; myAuthorId: string }[]
  ): Promise<RoomData[]> {
    try {
      const roomData: RoomData[] = rooms.map(({ roomId, myAuthorId }) => {
        return {
          id: roomId,
          boardId: '',
          threadId: '',
          myAuthorId,
          participants: [],
          unread: 0,
        };
      });

      // Scan IP data for each room. This will become the room participants list.
      let results: any[] = await Promise.all(
        rooms.map(({ roomId }) => {
          return this.scanKeys(`room:${roomId}:ip:*:data`);
        })
      );

      const multi = this.redisClient.multi();

      // Loop through each room.
      for (let i = 0; i < rooms.length; i++) {
        const roomId = rooms[i].roomId;
        multi.hgetall(`room:${roomId}:data`);
        multi.get(`room:${roomId}:ip:${ipHash}:unread`);
        // Loop through each participant.
        const participantKeys = results[i];
        for (const key of participantKeys) {
          const split = key.split(':');
          const ipHash = split[3];
          multi.get(`ip:${ipHash}:online`);
          multi.hgetall(`room:${roomId}:ip:${ipHash}:data`);
          roomData[i].participants.push({ authorId: '', online: false }); // Placeholder.
        }
      }

      results = await multi.exec();

      // Loop through each room.
      let j = 0;
      for (let i = 0; i < rooms.length; i++) {
        const [, _roomData] = results[j++];
        const [, unreadCount] = results[j++];
        roomData[i].boardId = _roomData.boardId;
        roomData[i].threadId = _roomData.threadId;
        roomData[i].unread = parseInt(unreadCount) || 0;
        // Loop through each participant.
        for (const participant of roomData[i].participants) {
          const [, online] = results[j++];
          const [, ipData] = results[j++];
          participant.online = online === '1';
          participant.authorId = ipData.authorId;
        }
      }

      return roomData;
    } catch (error) {
      logger.error(`Error compiling room data. ${error}`);
    }
    return [];
  }

  /*
   * Verifies that a user is in the given room.
   */
  public async inRoom(ipHash: string, roomId: string): Promise<boolean> {
    const inRoom =
      (await this.redisClient.exists(`room:${roomId}:ip:${ipHash}:data`)) > 0;
    return inRoom;
  }

  /*
   * Gets all messages for the given room.
   */
  public async getMessages(ipHash: string, roomId: string): Promise<any[]> {
    try {
      const messageKeys = await this.scanKeys(`room:${roomId}:message:*:data`);
      const multi = this.redisClient.multi();
      multi.hget(`room:${roomId}:ip:${ipHash}:data`, 'authorId');
      for (const key of messageKeys) {
        multi.hgetall(key);
      }

      const results = await multi.exec();
      const [, myAuthorId] = results.shift() as [null | string, string];
      const messages = [];

      for (const [error, message] of results) {
        messages.push({
          from: message.from === myAuthorId ? null : message.from,
          content: message.content,
          createdAt: new Date(parseInt(message.createdAt)),
        });
      }
      return sortBy(messages, 'createdAt');
    } catch (error) {
      logger.error(`Error listing messages. ${error}`);
    }
    return [];
  }

  public async saveMessage(params: {
    roomId: string;
    ipHash: string;
    content: string;
  }): Promise<Message | undefined> {
    try {
      if (!params.content) {
        throw new Error('Missing message content');
      }
      if (typeof params.content !== 'string') {
        throw new Error('Invalid message content');
      }
      if (params.content.length > 250) {
        throw new Error('Message too long');
      }

      const authorId = await this.redisClient.hget(
        `room:${params.roomId}:ip:${params.ipHash}:data`,
        'authorId'
      );

      if (!authorId) {
        throw new Error('User not in room');
      }

      const participantKeys = await this.scanKeys(
        `room:${params.roomId}:ip:*:*`
      );

      // Post message and expire all room keys.
      const multi = this.redisClient.multi();
      const now = Date.now();
      const message = {
        roomId: params.roomId,
        from: authorId,
        content: params.content,
        createdAt: now,
      };
      multi.hmset(`room:${params.roomId}:message:${now}:data`, message);
      multi.expire(`room:${params.roomId}:message:${now}:data`, MESSAGE_TTL);
      multi.expire(`room:${params.roomId}:data`, MESSAGE_TTL);
      for (const key of participantKeys) {
        if (key.endsWith('unread') && !key.includes(`ip:${params.ipHash}`)) {
          multi.incr(key);
        }
        multi.expire(key, MESSAGE_TTL);
      }
      await multi.exec();
      return message;
    } catch (error) {
      logger.error(`Error saving message. ${error}`);
    }
  }

  /*
   * Recursively scans all keys matching the given pattern.
   */
  public async scanKeys(pattern: string) {
    const keys: Set<string> = new Set();
    let cursor = 0;
    do {
      const [cursorStr, results] = await this.redisClient.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = parseInt(cursorStr, 10);
      results.forEach((s) => keys.add(s));
    } while (cursor !== 0);
    return Array.from(keys);
  }
}

/*
 * Generates a randomly formatted 'lorem ipsum' post body.
 */
function generateMessageSet() {
  const loremIpsum = `Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiususer tempor incididunt ut labore et dolore magna aliqua. Ornare arcu odio ut sem nulla pharetra diam sit amet. Amet venenatis urna cursus eget nunc scelerisque. Elementum nisi quis eleifend quam adipiscing vitae proin sagittis nisl. Sem et tortor consequat id. Euisuser nisi porta lorem mollis aliquam ut porttitor. Mi bibendum neque egestas congue quisque. Egestas integer eget aliquet nibh praesent tristique magna sit amet. Vitae ultricies leo integer malesuada nunc. Nunc pulvinar sapien et ligula ullamcorper malesuada proin libero nunc. Neque sodales ut etiam sit. Sollicitudin ac orci phasellus egestas tellus rutrum. Gravida cum sociis natoque penatibus. Potenti nullam ac tortor vitae purus faucibus. Porta non pulvinar neque laoreet suspendisse. Vulputate sapien nec sagittis aliquam malesuada. Malesuada proin libero nunc consequat interdum varius sit. Congue mauris rhoncus aenean vel elit scelerisque mauris pellentesque pulvinar. Erat velit scelerisque in dictum non consectetur a. Nulla posuere sollicitudin aliquam ultrices sagittis. Lectus urna duis convallis convallis tellus. In vitae turpis massa sed elementum tempus egestas. Mi eget mauris pharetra et ultrices neque ornare aenean. Malesuada proin libero nunc consequat interdum varius sit. Feugiat in ante metus dictum at tempor comusero ullamcorper. Non quam lacus suspendisse faucibus. Tempus iaculis urna id volutpat lacus. Et leo duis ut diam quam nulla porttitor massa. Malesuada proin libero nunc consequat. Tellus in metus vulputate eu scelerisque felis imperdiet. Fusce id velit ut tortor pretium. Tristique risus nec feugiat in fermentum posuere urna nec. Leo vel orci porta non pulvinar neque laoreet. Convallis a cras semper auctor neque. Semper risus in hendrerit gravida rutrum quisque. Nibh sed pulvinar proin gravida hendrerit. Amet risus nullam eget felis eget nunc lobortis mattis aliquam. Odio facilisis mauris sit amet massa vitae tortor condimentum. Non nisi est sit amet facilisis. Fermentum dui faucibus in ornare quam viverra orci sagittis. Donec enim diam vulputate ut pharetra sit amet. Nullam ac tortor vitae purus faucibus ornare suspendisse sed. Aliquet enim tortor at auctor urna nunc. Rhoncus urna neque viverra justo nec ultrices dui. Nisl pretium fusce id velit ut. Odio eu feugiat pretium nibh ipsum consequat. Tristique magna sit amet purus gravida quis blandit turpis cursus. Adipiscing bibendum est ultricies integer quis auctor elit sed vulputate. Nulla facilisi nullam vehicula ipsum. Felis imperdiet proin fermentum leo vel orci porta. Id semper risus in hendrerit gravida rutrum. Suspendisse in est ante in nibh mauris cursus. Eu consequat ac felis donec et odio pellentesque. Velit sed ullamcorper morbi tincidunt ornare massa. Donec massa sapien faucibus et molestie ac feugiat. Eget aliquet nibh praesent tristique magna sit amet. Cursus vitae congue mauris rhoncus. Tincidunt ornare massa eget egestas purus. Sed odio morbi quis comusero. Quis vel eros donec ac odio tempor orci dapibus ultrices. Ac tincidunt vitae semper quis lectus. Convallis aenean et tortor at. Cras sed felis eget velit aliquet. Morbi tempus iaculis urna id volutpat lacus laoreet non. Magna fringilla urna porttitor rhoncus dolor purus non enim. Massa massa ultricies mi quis hendrerit dolor magna eget est. Lorem ipsum dolor sit amet consectetur adipiscing elit pellentesque. Nisi est sit amet facilisis magna etiam. Etiam erat velit scelerisque in dictum non. Pulvinar neque laoreet suspendisse interdum consectetur libero id faucibus. Turpis massa sed elementum tempus egestas sed sed. Hendrerit dolor magna eget est lorem ipsum dolor. A diam maecenas sed enim ut sem viverra aliquet. Tortor vitae purus faucibus ornare suspendisse. Pharetra sit amet aliquam id. Est ante in nibh mauris cursus mattis. Scelerisque viverra mauris in aliquam sem fringilla ut. Lacus viverra vitae congue eu consequat ac felis donec et. In pellentesque massa placerat duis ultricies lacus. Id interdum velit laoreet id. Convallis a cras semper auctor neque. Malesuada proin libero nunc consequat interdum varius sit amet mattis. Mattis nunc sed blandit libero volutpat. Id aliquet risus feugiat in ante metus. Lectus proin nibh nisl condimentum id venenatis a. Facilisis leo vel fringilla est. Odio ut enim blandit volutpat maecenas volutpat blandit. Facilisi cras fermentum odio eu feugiat pretium nibh ipsum. Etiam sit amet nisl purus in mollis. Lobortis elementum nibh tellus molestie nunc non. Diam volutpat comusero sed egestas egestas fringilla. Ut tortor pretium viverra suspendisse potenti. Fringilla phasellus faucibus scelerisque eleifend donec pretium vulputate sapien nec. Etiam sit amet nisl purus in mollis nunc sed id. Lorem ipsum dolor sit amet. Ut ornare lectus sit amet est placerat in egestas. Egestas sed tempus urna et pharetra pharetra massa. Quis vel eros donec ac. Morbi tristique senectus et netus et malesuada. Fermentum posuere urna nec tincidunt praesent. Elit duis tristique sollicitudin nibh. Diam donec adipiscing tristique risus nec. Dignissim sodales ut eu sem integer vitae. Malesuada fames ac turpis egestas maecenas pharetra convallis posuere. Ut porttitor leo a diam sollicitudin tempor. Viverra nibh cras pulvinar mattis nunc sed blandit libero. Ut tellus elementum sagittis vitae et leo. Sagittis orci a scelerisque purus semper. Facilisi etiam dignissim diam quis enim lobortis scelerisque fermentum dui. Quam vulputate dignissim suspendisse in est. Integer vitae justo eget magna fermentum iaculis eu non. Mattis rhoncus urna neque viverra justo nec. Quis vel eros donec ac odio tempor. Pellentesque nec nam aliquam sem. Vulputate odio ut enim blandit. Comusero ullamcorper a lacus vestibulum sed arcu non. Non enim praesent elementum facilisis leo. Congue eu consequat ac felis donec et odio. Maecenas accumsan lacus vel facilisis volutpat. Et tortor at risus viverra adipiscing. Vel orci porta non pulvinar neque laoreet suspendisse interdum. Dignissim enim sit amet venenatis urna cursus eget nunc scelerisque. Proin sed libero enim sed faucibus turpis. Orci ac auctor augue mauris augue. Vitae aliquet nec ullamcorper sit amet risus. Mauris in aliquam sem fringilla ut. Aenean vel elit scelerisque mauris pellentesque pulvinar pellentesque. Amet nisl purus in mollis nunc. Porta non pulvinar neque laoreet suspendisse interdum. Tincidunt praesent semper feugiat nibh sed pulvinar proin gravida. Risus comusero viverra maecenas accumsan lacus. Non quam lacus suspendisse faucibus interdum. Mollis nunc sed id semper. Sit amet consectetur adipiscing elit ut. Enim lobortis scelerisque fermentum dui. Quis ipsum suspendisse ultrices gravida dictum fusce. Condimentum vitae sapien pellentesque habitant morbi tristique senectus. Comusero ullamcorper a lacus vestibulum sed arcu. Sem nulla pharetra diam sit amet. Quis hendrerit dolor magna eget est lorem ipsum dolor sit. Mollis aliquam ut porttitor leo. Nunc congue nisi vitae suscipit tellus mauris a. Feugiat nisl pretium fusce id. Nec sagittis aliquam malesuada bibendum. Eu volutpat odio facilisis mauris sit amet massa. Viverra vitae congue eu consequat ac. Dolor magna eget est lorem ipsum dolor sit. Ut venenatis tellus in metus vulputate eu scelerisque. Nibh nisl condimentum id venenatis a condimentum vitae sapien pellentesque. Dui vivamus arcu felis bibendum ut. Id semper risus in hendrerit gravida rutrum quisque non tellus. Scelerisque mauris pellentesque pulvinar pellentesque habitant morbi tristique senectus et. Mattis aliquam faucibus purus in massa tempor nec. Amet nulla facilisi morbi tempus iaculis urna. Semper auctor neque vitae tempus quam pellentesque nec nam aliquam. Interdum varius sit amet mattis vulputate enim nulla aliquet. Elementum tempus egestas sed sed risus pretium quam. Ac ut consequat semper viverra nam. Mattis aliquam faucibus purus in massa. Sit amet comusero nulla facilisi nullam vehicula. Sit amet comusero nulla facilisi nullam vehicula ipsum. Lectus mauris ultrices eros in cursus. Tincidunt dui ut ornare lectus sit amet est. At auctor urna nunc id cursus. Tincidunt id aliquet risus feugiat in ante metus dictum at. Sapien eget mi proin sed libero. Dictum fusce ut placerat orci nulla pellentesque dignissim. Lectus urna duis convallis convallis tellus id interdum. Eget nullam non nisi est sit amet facilisis magna etiam. Vestibulum lorem sed risus ultricies. Vel quam elementum pulvinar etiam. Arcu non odio euisuser lacinia at. Phasellus vestibulum lorem sed risus ultricies tristique nulla aliquet. Nullam eget felis eget nunc lobortis mattis aliquam. Venenatis urna cursus eget nunc scelerisque viverra mauris. Vel risus comusero viverra maecenas accumsan lacus. Sed velit dignissim sodales ut eu sem integer vitae justo. Risus viverra adipiscing at in tellus. Id venenatis a condimentum vitae sapien pellentesque. A arcu cursus vitae congue. At tempor comusero ullamcorper a lacus vestibulum sed. Tristique sollicitudin nibh sit amet comusero nulla facilisi. Gravida neque convallis a cras semper auctor neque vitae tempus. Sit amet aliquam id diam maecenas. Vitae et leo duis ut diam quam nulla porttitor. Odio eu feugiat pretium nibh ipsum consequat. Viverra adipiscing at in tellus integer. Volutpat lacus laoreet non curabitur gravida arcu ac tortor. Libero justo laoreet sit amet cursus. Orci dapibus ultrices in iaculis nunc sed augue. Tortor pretium viverra suspendisse potenti. Eleifend donec pretium vulputate sapien nec sagittis aliquam malesuada. Sapien eget mi proin sed libero. Cras pulvinar mattis nunc sed blandit libero volutpat sed cras. Diam phasellus vestibulum lorem sed risus ultricies tristique nulla. Vitae nunc sed velit dignissim sodales ut eu sem. Enim ut tellus elementum sagittis vitae et. Sed vulputate mi sit amet mauris comusero quis imperdiet. Cursus metus aliquam eleifend mi in nulla posuere. Nulla facilisi etiam dignissim diam quis. Lacus laoreet non curabitur gravida arcu ac. In tellus integer feugiat scelerisque varius morbi enim nunc faucibus. Accumsan sit amet nulla facilisi morbi. Quis imperdiet massa tincidunt nunc pulvinar sapien et. Mauris comusero quis imperdiet massa. Eget nullam non nisi est sit. Dignissim sodales ut eu sem integer vitae justo. Nec ultrices dui sapien eget mi proin sed. At auctor urna nunc id cursus. Posuere ac ut consequat semper. Arcu non odio euisuser lacinia at. Vel pretium lectus quam id leo.`;
  const sentences = loremIpsum.split(/\.\s/g);
  // Each chat room contains 1 to 20 messages.
  const messageCount = random(1, 20);
  const messages = [];
  for (let i = 0; i < messageCount; i++) {
    const message = [];
    // Each message contains 1 to 5 sentences.
    const sentenceCount = random(1, 5);
    for (let j = 0; j < sentenceCount; j++) {
      const sentence = sentences[random(0, sentences.length)];
      message.push(sentence + '.');
    }
    messages.push({
      fromSelf: Math.random() > 0.5,
      content: message.join(' '),
    });
  }
  return messages;
}

/*
 * Returns a random whole number (min <= n < max) in the given range.
 */
function random(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min);
}
