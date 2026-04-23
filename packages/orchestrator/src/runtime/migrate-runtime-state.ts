import type { DigitalLifeDatabase } from '@digital-life/core';

import { ensureKnowledgeTables } from '../repositories/knowledge-state-schema';
import { ensureReflectionTables } from '../repositories/reflection-state-schema';
import { ensureRuntimeStateTables } from '../repositories/runtime-state-schema';

export const migrateRuntimeState = async (database: DigitalLifeDatabase): Promise<void> => {
  await ensureRuntimeStateTables(database);
  await ensureKnowledgeTables(database);
  await ensureReflectionTables(database);
};
