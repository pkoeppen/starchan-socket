import { Redis, ValueType } from 'ioredis';

const SESSION_TTL = 24 * 60 * 60;
const parseValues = ([ipHash, connected]: (string | null)[]) =>
  ipHash ? { ipHash, connected: connected === 'true' } : undefined;

export default class RedisSessionStore {
  redisClient: Redis;
  constructor(redisClient: Redis) {
    this.redisClient = redisClient;
  }

  public findSession(sessionId: string): Promise<any> {
    return this.redisClient
      .hmget(`session:${sessionId}`, 'ipHash', 'connected')
      .then(parseValues);
  }

  public saveSession(
    sessionId: string,
    params: { ipHash: string; connected: string }
  ): void {
    this.redisClient
      .multi()
      .hset(`session:${sessionId}`, ...pairReduce(params))
      .expire(`session:${sessionId}`, SESSION_TTL)
      .exec();
  }

  public async findAllSessions(): Promise<any> {
    const keys: Set<string> = new Set();
    let cursor = 0;
    do {
      const [cursorStr, results] = await this.redisClient.scan(
        cursor,
        'MATCH',
        'session:*',
        'COUNT',
        100
      );
      cursor = parseInt(cursorStr, 10);
      results.forEach((s) => keys.add(s));
    } while (cursor !== 0);

    const multi = this.redisClient.multi();
    for (const key of Array.from(keys)) {
      multi.hmget(key, 'ipHash', 'connected');
    }
    return multi.exec().then((results) => {
      return results
        .map(([err, session]) => (err ? undefined : parseValues(session)))
        .filter((v) => !!v);
    });
  }
}

/*
 * Converts an object to an array of key-value pairs.
 */
function pairReduce(obj: Record<string, ValueType>) {
  return Object.keys(obj).reduce((acc: ValueType[], key) => {
    const val = obj[key];
    return acc.concat([key, val]);
  }, []);
}
