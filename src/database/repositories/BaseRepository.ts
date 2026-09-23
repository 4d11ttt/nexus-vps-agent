import type { DbConnection } from '../types.js';

export abstract class BaseRepository {
  constructor(protected readonly db: DbConnection) {}
}
