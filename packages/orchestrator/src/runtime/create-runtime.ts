import {
  createUnifiedToolRegistry,
  loadBuiltinConnectors,
  loadExtensionConnectors,
  loadMcpConnectors,
  type McpBridgeFactory,
  type SourceToolConnector,
  type UnifiedToolRegistry,
} from '@digital-life/connectors';
import {
  createDatabase,
  createDenseMemClient,
  type DenseMemClient,
  type DigitalLifeConfig,
  type DigitalLifeDatabase,
  loadPromptOverrideContents,
} from '@digital-life/core';
import {
  createInMemoryKnowledgeRepository,
  type KnowledgeRepository,
} from '../repositories/knowledge-repository';
import { ensureKnowledgeTables } from '../repositories/knowledge-state-schema';
import { createPostgresKnowledgeRepository } from '../repositories/postgres-knowledge-repository';
import { createPostgresReflectionRepository } from '../repositories/postgres-reflection-repository';
import { createPostgresRuntimeStateRepository } from '../repositories/postgres-runtime-state-repository';
import {
  createInMemoryReflectionRepository,
  type ReflectionRepository,
} from '../repositories/reflection-repository';
import { ensureReflectionTables } from '../repositories/reflection-state-schema';
import {
  createInMemoryRuntimeStateRepository,
  type RuntimeStateRepository,
} from '../repositories/runtime-state-repository';
import { ensureRuntimeStateTables } from '../repositories/runtime-state-schema';
import { BootstrapService } from '../services/bootstrap-service';
import { ChatService } from '../services/chat-service';
import { ConnectorService } from '../services/connector-service';
import { KnowledgeService } from '../services/knowledge-service';
import { LearningService } from '../services/learning-service';
import { ReadinessService } from '../services/readiness-service';
import { ReflectionService } from '../services/reflection-service';
import { StartupService } from '../services/startup-service';

export type DigitalLifeRuntime = {
  bootstrapService: BootstrapService;
  config: DigitalLifeConfig;
  chatService: ChatService;
  connectorService: ConnectorService;
  connectors: SourceToolConnector[];
  knowledgeService: KnowledgeService;
  reflectionService: ReflectionService;
  learningService: LearningService;
  promptOverrides: Record<string, string>;
  readinessService: ReadinessService;
  registry: UnifiedToolRegistry;
  knowledgeRepository: KnowledgeRepository;
  reflectionRepository: ReflectionRepository;
  repository: RuntimeStateRepository;
  startupService: StartupService;
};

const resolveConfiguredDatabase = ({
  database,
  knowledgeRepository,
  reflectionRepository,
  repository,
}: {
  database: DigitalLifeDatabase | undefined;
  knowledgeRepository: KnowledgeRepository | undefined;
  reflectionRepository: ReflectionRepository | undefined;
  repository: RuntimeStateRepository | undefined;
}): DigitalLifeDatabase | undefined =>
  database ??
  (repository || knowledgeRepository || reflectionRepository || !process.env.DATABASE_URL
    ? undefined
    : createDatabase(process.env.DATABASE_URL));

const resolveKnowledgeRepository = async ({
  database,
  repository,
}: {
  database: DigitalLifeDatabase | undefined;
  repository: KnowledgeRepository | undefined;
}): Promise<KnowledgeRepository> => {
  if (repository) {
    return repository;
  }

  if (!database) {
    return createInMemoryKnowledgeRepository();
  }

  await ensureKnowledgeTables(database);
  return createPostgresKnowledgeRepository({ database });
};

const resolveReflectionRepository = async ({
  database,
  repository,
}: {
  database: DigitalLifeDatabase | undefined;
  repository: ReflectionRepository | undefined;
}): Promise<ReflectionRepository> => {
  if (repository) {
    return repository;
  }

  if (!database) {
    return createInMemoryReflectionRepository();
  }

  await ensureReflectionTables(database);
  return createPostgresReflectionRepository({ database });
};

const resolveRuntimeRepository = async ({
  config,
  database,
  repository,
}: {
  config: DigitalLifeConfig;
  database: DigitalLifeDatabase | undefined;
  repository: RuntimeStateRepository | undefined;
}): Promise<RuntimeStateRepository> => {
  if (repository) {
    return repository;
  }

  if (!database) {
    return createInMemoryRuntimeStateRepository();
  }

  await ensureRuntimeStateTables(database);
  return createPostgresRuntimeStateRepository({
    database,
    personaId: config.persona.id,
  });
};

export const createRuntime = async ({
  bridgeFactory,
  config,
  database,
  denseMemClient = createDenseMemClient({
    baseUrl: config.denseMem.baseUrl,
    timeoutMs: config.denseMem.timeoutMs,
  }),
  knowledgeRepository: knowledgeRepositoryOverride,
  reflectionRepository: reflectionRepositoryOverride,
  repository: repositoryOverride,
}: {
  bridgeFactory?: McpBridgeFactory;
  config: DigitalLifeConfig;
  database?: DigitalLifeDatabase;
  denseMemClient?: DenseMemClient;
  knowledgeRepository?: KnowledgeRepository;
  reflectionRepository?: ReflectionRepository;
  repository?: RuntimeStateRepository;
}): Promise<DigitalLifeRuntime> => {
  const configuredDatabase = resolveConfiguredDatabase({
    database,
    knowledgeRepository: knowledgeRepositoryOverride,
    reflectionRepository: reflectionRepositoryOverride,
    repository: repositoryOverride,
  });
  const repository = await resolveRuntimeRepository({
    config,
    database: configuredDatabase,
    repository: repositoryOverride,
  });
  const knowledgeRepository = await resolveKnowledgeRepository({
    database: configuredDatabase,
    repository: knowledgeRepositoryOverride,
  });
  const reflectionRepository = await resolveReflectionRepository({
    database: configuredDatabase,
    repository: reflectionRepositoryOverride,
  });
  const promptOverrides = await loadPromptOverrideContents(config);
  const builtinConnectors = loadBuiltinConnectors(config.connectors);
  const extensionConnectors = await loadExtensionConnectors(config.connectors);
  const mcpConnectors = await loadMcpConnectors(
    bridgeFactory
      ? {
          bridgeFactory,
          connectors: config.connectors,
        }
      : {
          connectors: config.connectors,
        },
  );
  const connectors = [...builtinConnectors, ...extensionConnectors, ...mcpConnectors];
  const registry = await createUnifiedToolRegistry({ connectors });
  const knowledgeService = new KnowledgeService(knowledgeRepository);
  const readinessService = new ReadinessService(connectors, registry, repository);
  const reflectionService = new ReflectionService(
    connectors,
    registry,
    reflectionRepository,
    repository,
  );
  const startupService = new StartupService(
    config,
    connectors,
    repository,
    promptOverrides,
    async () => {
      await readinessService.recompute();
      await reflectionService.recompute();
    },
  );
  const connectorService = new ConnectorService(
    config,
    connectors,
    registry,
    repository,
    () => readinessService.getReadiness(),
    () => reflectionService.recompute(),
  );
  const learningService = new LearningService(
    config,
    connectors,
    registry,
    repository,
    denseMemClient,
    knowledgeService,
    async () => {
      await readinessService.recompute();
      await reflectionService.recompute();
    },
  );
  const bootstrapService = new BootstrapService(connectors, repository, learningService);
  const chatService = new ChatService(knowledgeService, knowledgeRepository);

  return {
    bootstrapService,
    chatService,
    config,
    connectorService,
    connectors,
    knowledgeRepository,
    knowledgeService,
    reflectionRepository,
    reflectionService,
    learningService,
    promptOverrides,
    readinessService,
    registry,
    repository,
    startupService,
  };
};
