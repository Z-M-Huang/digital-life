import {
  type ConsolidationAgent,
  createConcurrencyLimiter,
  createConsolidationAgent,
  createDefaultLearners,
  createLLMClientFromConfig,
  createMockLLMClient,
  createQueryAgent,
  type LLMClient,
  loadPrompts,
  type PromptBundle,
  type QueryAgent,
} from '@digital-life/agents';
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
import { createPostgresToolLearningRepository } from '../repositories/postgres-tool-learning-repository';
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
import {
  createInMemoryToolLearningRepository,
  type ToolLearningRepository,
} from '../repositories/tool-learning-repository';
import { BootstrapService } from '../services/bootstrap-service';
import { ChatService } from '../services/chat-service';
import { ConnectorService } from '../services/connector-service';
import { GapService } from '../services/gap-service';
import { KnowledgeService } from '../services/knowledge-service';
import { LearningService } from '../services/learning-service';
import { MaintenanceService } from '../services/maintenance-service';
import { ReadinessService } from '../services/readiness-service';
import { ReflectionService } from '../services/reflection-service';
import { createScheduler, type Scheduler } from '../services/scheduler';
import { StartupService } from '../services/startup-service';
import { ToolLearningService } from '../services/tool-learning-service';

export type DigitalLifeRuntime = {
  bootstrapService: BootstrapService;
  config: DigitalLifeConfig;
  chatService: ChatService;
  connectorService: ConnectorService;
  connectors: SourceToolConnector[];
  consolidationAgent: ConsolidationAgent;
  gapService: GapService;
  knowledgeService: KnowledgeService;
  llmClient: LLMClient;
  maintenanceService: MaintenanceService;
  prompts: PromptBundle;
  queryAgent: QueryAgent;
  reflectionService: ReflectionService;
  scheduler: Scheduler;
  toolLearningRepository: ToolLearningRepository;
  toolLearningService: ToolLearningService;
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

const buildLlmClient = (config: DigitalLifeConfig): LLMClient => {
  if (config.ai.apiKey || process.env.DIGITAL_LIFE_AI_API_KEY) {
    return createLLMClientFromConfig(config);
  }
  if (process.env.NODE_ENV === 'production' && !process.env.DIGITAL_LIFE_ALLOW_MOCK_LLM) {
    throw new Error(
      'No LLM credentials configured. Set DIGITAL_LIFE_AI_API_KEY (or config.ai.apiKey), or set DIGITAL_LIFE_ALLOW_MOCK_LLM=1 to opt into the mock client (not recommended in production).',
    );
  }
  return createMockLLMClient({ modelId: config.ai.model, extractionVersion: '0' });
};

export const createRuntime = async ({
  bridgeFactory,
  config,
  database,
  denseMemClient = createDenseMemClient({
    baseUrl: config.denseMem.baseUrl,
    apiKey: config.denseMem.apiKey,
    timeoutMs: config.denseMem.timeoutMs,
  }),
  knowledgeRepository: knowledgeRepositoryOverride,
  llmClient: llmClientOverride,
  reflectionRepository: reflectionRepositoryOverride,
  repository: repositoryOverride,
  toolLearningRepository: toolLearningRepositoryOverride,
}: {
  bridgeFactory?: McpBridgeFactory;
  config: DigitalLifeConfig;
  database?: DigitalLifeDatabase;
  denseMemClient?: DenseMemClient;
  knowledgeRepository?: KnowledgeRepository;
  llmClient?: LLMClient;
  reflectionRepository?: ReflectionRepository;
  repository?: RuntimeStateRepository;
  toolLearningRepository?: ToolLearningRepository;
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
  const llmClient = llmClientOverride ?? buildLlmClient(config);
  const prompts = await loadPrompts(config);
  const learnerLimiter = createConcurrencyLimiter(config.ai.maxConcurrency);
  const learners = createDefaultLearners({
    client: llmClient,
    prompts,
    limiter: learnerLimiter,
  });
  const queryAgent = createQueryAgent({ client: llmClient, prompts });
  const consolidationAgent = createConsolidationAgent({ client: llmClient, prompts });
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
  const knowledgeService = new KnowledgeService(knowledgeRepository, denseMemClient);
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
    learners,
    consolidationAgent,
    async () => {
      await readinessService.recompute();
      await reflectionService.recompute();
    },
  );
  const toolLearningRepository =
    toolLearningRepositoryOverride ??
    (configuredDatabase
      ? createPostgresToolLearningRepository({ database: configuredDatabase })
      : createInMemoryToolLearningRepository());
  const gapService = new GapService(toolLearningRepository, reflectionService);
  const toolLearningService = new ToolLearningService(toolLearningRepository);
  const bootstrapService = new BootstrapService(connectors, repository, learningService);
  const chatService = new ChatService(
    knowledgeService,
    knowledgeRepository,
    queryAgent,
    llmClient,
    bootstrapService,
  );
  const maintenanceService = new MaintenanceService({
    connectors,
    denseMemClient,
    learningService,
    reflectionService,
    readinessService,
  });
  const scheduler = createScheduler({
    config: config.maintenance,
    task: async () => {
      await maintenanceService.runCycle();
    },
  });

  return {
    bootstrapService,
    chatService,
    config,
    connectorService,
    connectors,
    consolidationAgent,
    gapService,
    knowledgeRepository,
    knowledgeService,
    llmClient,
    maintenanceService,
    prompts,
    queryAgent,
    reflectionRepository,
    reflectionService,
    learningService,
    promptOverrides,
    readinessService,
    registry,
    repository,
    scheduler,
    startupService,
    toolLearningRepository,
    toolLearningService,
  };
};
