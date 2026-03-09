export type ViralStudioPersistenceMode = 'memory' | 'dual' | 'db';
export type ViralStudioReadStrategy = 'memory-first' | 'db-first';

export type ViralStudioWorkspaceStorageMode = {
  mode: ViralStudioPersistenceMode;
  readStrategy: ViralStudioReadStrategy;
  readsFromDb: boolean;
  writesToDb: boolean;
  writesToMemory: boolean;
  gatedDbRead: boolean;
};

function normalize(value: unknown): string {
  return String(value || '').trim();
}

function parseMode(raw: string): ViralStudioPersistenceMode {
  const mode = raw.toLowerCase();
  if (mode === 'db') return 'db';
  if (mode === 'dual') return 'dual';
  return 'memory';
}

function parseWorkspaceGate(raw: string): Set<string> {
  const set = new Set<string>();
  for (const item of raw.split(',')) {
    const value = normalize(item);
    if (!value) continue;
    set.add(value);
  }
  return set;
}

function matchesWorkspaceGate(workspaceId: string, gate: Set<string>): boolean {
  if (!gate.size) return false;
  if (gate.has('*')) return true;
  return gate.has(normalize(workspaceId));
}

export function resolveViralStudioWorkspaceStorageMode(workspaceId: string): ViralStudioWorkspaceStorageMode {
  const mode = parseMode(normalize(process.env.VIRAL_STUDIO_PERSISTENCE_MODE) || 'memory');
  if (mode === 'memory') {
    return {
      mode,
      readStrategy: 'memory-first',
      readsFromDb: false,
      writesToDb: false,
      writesToMemory: true,
      gatedDbRead: false,
    };
  }
  if (mode === 'db') {
    return {
      mode,
      readStrategy: 'db-first',
      readsFromDb: true,
      writesToDb: true,
      writesToMemory: true,
      gatedDbRead: true,
    };
  }
  const gate = parseWorkspaceGate(normalize(process.env.VIRAL_STUDIO_DB_READ_WORKSPACES));
  const gatedDbRead = matchesWorkspaceGate(workspaceId, gate);
  return {
    mode,
    readStrategy: gatedDbRead ? 'db-first' : 'memory-first',
    readsFromDb: gatedDbRead,
    writesToDb: true,
    writesToMemory: true,
    gatedDbRead,
  };
}

export function getViralStudioStorageModeDiagnostics(workspaceId: string): {
  workspaceId: string;
  mode: ViralStudioPersistenceMode;
  readStrategy: ViralStudioReadStrategy;
  readsFromDb: boolean;
  writesToDb: boolean;
  writesToMemory: boolean;
  gatedDbRead: boolean;
  env: {
    VIRAL_STUDIO_PERSISTENCE_MODE: string;
    VIRAL_STUDIO_DB_READ_WORKSPACES: string;
  };
} {
  const resolved = resolveViralStudioWorkspaceStorageMode(workspaceId);
  return {
    workspaceId: normalize(workspaceId),
    mode: resolved.mode,
    readStrategy: resolved.readStrategy,
    readsFromDb: resolved.readsFromDb,
    writesToDb: resolved.writesToDb,
    writesToMemory: resolved.writesToMemory,
    gatedDbRead: resolved.gatedDbRead,
    env: {
      VIRAL_STUDIO_PERSISTENCE_MODE: normalize(process.env.VIRAL_STUDIO_PERSISTENCE_MODE) || 'memory',
      VIRAL_STUDIO_DB_READ_WORKSPACES: normalize(process.env.VIRAL_STUDIO_DB_READ_WORKSPACES),
    },
  };
}
