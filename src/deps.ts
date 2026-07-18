// The narrow Redis surface the app depends on: exactly the commands in use,
// nothing else. Production wraps the real node-redis client into this shape;
// tests fake it with a Map. Routes never see the full client API.
export interface RedisLike {
  set(key: string, value: string, options: { condition: "NX" }): Promise<string | null>;
  get(key: string): Promise<string | null>;
  ping(): Promise<string>;
}

export interface AppDeps {
  redis: RedisLike;
}
