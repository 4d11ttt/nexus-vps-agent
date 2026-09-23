import type { Migration } from '../MigrationRunner.js';
import { migration as m001 } from './001_initial.js';
import { migration as m002 } from './002_scheduler.js';
import { migration as m003 } from './003_user_settings.js';

export const migrations: Migration[] = [m001, m002, m003];
