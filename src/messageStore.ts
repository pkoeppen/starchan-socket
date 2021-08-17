import { Redis, ValueType } from 'ioredis';

const CONVERSATION_TTL = 24 * 60 * 60;

export default class RedisMessageStore {
  redisClient: Redis;
  constructor(redisClient: Redis) {
    this.redisClient = redisClient;
  }

  public saveMessage(message: {
    to: string;
    from: string;
    content: string;
  }): void {
    const value = JSON.stringify(message);
    this.redisClient
      .multi()
      .rpush(`messages:${message.from}`, value)
      .rpush(`messages:${message.to}`, value)
      .expire(`messages:${message.from}`, CONVERSATION_TTL)
      .expire(`messages:${message.to}`, CONVERSATION_TTL)
      .exec();
  }

  public findMessagesForUser(ipHash: string): Promise<any> {
    return this.redisClient
      .lrange(`messages:${ipHash}`, 0, -1)
      .then((results) => {
        return results.map((result) => JSON.parse(result));
      });
  }
}
