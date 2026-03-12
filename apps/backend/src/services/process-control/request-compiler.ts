import crypto from 'node:crypto';
import { ProcessRunDocumentType } from '@prisma/client';
import {
  getArtifactSection,
  getArtifactStandardPack,
  normalizePhase2ArtifactType,
  type Phase2ArtifactType,
  type StandardSectionDefinition,
} from './standards-registry';

export const PHASE2_REQUEST_MODES = [
  'single_doc',
  'section_bundle',
  'multi_doc_bundle',
] as const;

export type Phase2RequestMode = (typeof PHASE2_REQUEST_MODES)[number];

export type ProcessRunTargetInput = {
  artifactType: string;
  sections?: string[];
  objective?: string;
};

export type CompiledArtifactPlan = {
  artifactKey: string;
  artifactType: Phase2ArtifactType;
  objective: string;
  requestedSections: string[] | null;
  selectedSections: string[];
  standardId: string;
  standardVersion: number;
  professorMethod: string;
};

export type CompiledSectionNode = {
  nodeId: string;
  artifactKey: string;
  artifactType: Phase2ArtifactType;
  sectionKey: string;
  title: string;
  framework: string;
  order: number;
  dependsOnNodeIds: string[];
  requiredInputs: StandardSectionDefinition['requiredInputs'];
  exitCriteria: string[];
  minEvidence: number;
  minWords: number;
  standardId: string;
  standardVersion: number;
};

export type CompiledProcessPlan = {
  version: 'phase2.v1';
  mode: Phase2RequestMode;
  rootObjective: string;
  primaryArtifactType: Phase2ArtifactType;
  artifacts: CompiledArtifactPlan[];
  sections: CompiledSectionNode[];
  planHash: string;
};

export type CompileProcessPlanInput = {
  objective: string;
  documentType?: ProcessRunDocumentType;
  requestMode?: string;
  targets?: ProcessRunTargetInput[];
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeSectionKey(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9_:-]+/g, '_');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeRequestMode(value: unknown): Phase2RequestMode | null {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return null;
  if ((PHASE2_REQUEST_MODES as readonly string[]).includes(raw)) {
    return raw as Phase2RequestMode;
  }
  if (raw === 'single' || raw === 'single_document') return 'single_doc';
  if (raw === 'sections' || raw === 'section_only') return 'section_bundle';
  if (raw === 'multi' || raw === 'composite') return 'multi_doc_bundle';
  return null;
}

function deterministicStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => deterministicStringify(item)).join(',')}]`;
  }
  const source = asRecord(value);
  const keys = Object.keys(source).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${deterministicStringify(source[key])}`);
  return `{${parts.join(',')}}`;
}

function ensureDefaultTargets(input: CompileProcessPlanInput): ProcessRunTargetInput[] {
  if (Array.isArray(input.targets) && input.targets.length > 0) {
    return input.targets;
  }

  const fromDocumentType = normalizePhase2ArtifactType(input.documentType);
  if (fromDocumentType) {
    return [{ artifactType: fromDocumentType, objective: input.objective }];
  }

  return [{ artifactType: 'BUSINESS_STRATEGY', objective: input.objective }];
}

function expandDependencies(
  requestedSections: string[],
  sectionByKey: Map<string, StandardSectionDefinition>
): string[] {
  const selected = new Set<string>();
  const stack = [...requestedSections];

  while (stack.length) {
    const next = stack.pop();
    if (!next) continue;
    if (selected.has(next)) continue;
    selected.add(next);

    const section = sectionByKey.get(next);
    if (!section) continue;
    for (const dependency of section.dependsOn || []) {
      if (!selected.has(dependency)) {
        stack.push(dependency);
      }
    }
  }

  return [...selected];
}

function topologicalOrder(nodes: CompiledSectionNode[]): CompiledSectionNode[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) {
    incoming.set(node.nodeId, node.dependsOnNodeIds.length);
    for (const dependency of node.dependsOnNodeIds) {
      const edges = outgoing.get(dependency) || [];
      edges.push(node.nodeId);
      outgoing.set(dependency, edges);
    }
  }

  const queue = nodes
    .filter((node) => (incoming.get(node.nodeId) || 0) === 0)
    .sort((a, b) => a.order - b.order || a.nodeId.localeCompare(b.nodeId))
    .map((node) => node.nodeId);

  const ordered: CompiledSectionNode[] = [];
  while (queue.length) {
    const nextId = queue.shift();
    if (!nextId) continue;
    const node = byId.get(nextId);
    if (!node) continue;
    ordered.push(node);

    const edges = outgoing.get(nextId) || [];
    for (const targetId of edges) {
      const nextIncoming = (incoming.get(targetId) || 0) - 1;
      incoming.set(targetId, nextIncoming);
      if (nextIncoming === 0) {
        queue.push(targetId);
      }
    }

    queue.sort((left, right) => {
      const leftNode = byId.get(left);
      const rightNode = byId.get(right);
      if (!leftNode || !rightNode) return left.localeCompare(right);
      return leftNode.order - rightNode.order || left.localeCompare(right);
    });
  }

  if (ordered.length !== nodes.length) {
    throw new Error('Phase 2 plan contains cyclic section dependencies.');
  }

  return ordered.map((node, index) => ({
    ...node,
    order: index + 1,
  }));
}

function resolveMode(input: {
  requestMode: Phase2RequestMode | null;
  artifactsCount: number;
  hasSectionSubset: boolean;
}): Phase2RequestMode {
  if (input.requestMode) return input.requestMode;
  if (input.artifactsCount > 1) return 'multi_doc_bundle';
  if (input.hasSectionSubset) return 'section_bundle';
  return 'single_doc';
}

export function compileProcessPlan(input: CompileProcessPlanInput): CompiledProcessPlan {
  const objective = normalizeText(input.objective) || 'Build strategy deliverables';
  const incomingTargets = ensureDefaultTargets(input);

  const artifacts: CompiledArtifactPlan[] = [];
  const nodes: CompiledSectionNode[] = [];

  for (let index = 0; index < incomingTargets.length; index += 1) {
    const target = incomingTargets[index];
    const artifactType = normalizePhase2ArtifactType(target.artifactType);
    if (!artifactType) {
      throw new Error(`Unsupported artifactType: ${normalizeText(target.artifactType) || '<empty>'}`);
    }

    const pack = getArtifactStandardPack(artifactType);
    const artifactKey = `${artifactType.toLowerCase()}_${index + 1}`;
    const sectionByKey = new Map(pack.sections.map((section) => [section.key, section]));
    const rawRequestedSections = Array.isArray(target.sections)
      ? target.sections.map((entry) => normalizeSectionKey(entry)).filter(Boolean)
      : [];

    let selectedSectionKeys: string[];
    if (!rawRequestedSections.length) {
      selectedSectionKeys = pack.sections.map((section) => section.key);
    } else {
      const validRequested = rawRequestedSections.filter((key) => sectionByKey.has(key));
      if (!validRequested.length) {
        throw new Error(`No valid sections requested for ${artifactType}`);
      }
      selectedSectionKeys = expandDependencies(validRequested, sectionByKey);
    }

    const selectedSections = selectedSectionKeys
      .map((key) => getArtifactSection(pack, key))
      .filter((section): section is StandardSectionDefinition => Boolean(section))
      .sort((a, b) => a.order - b.order);

    if (!selectedSections.length) {
      throw new Error(`No sections resolved for ${artifactType}`);
    }

    artifacts.push({
      artifactKey,
      artifactType,
      objective: normalizeText(target.objective) || objective,
      requestedSections: rawRequestedSections.length ? [...rawRequestedSections] : null,
      selectedSections: selectedSections.map((section) => section.key),
      standardId: pack.standardId,
      standardVersion: pack.standardVersion,
      professorMethod: pack.professorMethod,
    });

    const selectedSet = new Set(selectedSections.map((section) => section.key));
    for (const section of selectedSections) {
      const dependsOnNodeIds = (section.dependsOn || [])
        .filter((dependencyKey) => selectedSet.has(dependencyKey))
        .map((dependencyKey) => `${artifactKey}::${dependencyKey}`);
      nodes.push({
        nodeId: `${artifactKey}::${section.key}`,
        artifactKey,
        artifactType,
        sectionKey: section.key,
        title: section.title,
        framework: section.framework,
        order: section.order,
        dependsOnNodeIds,
        requiredInputs: section.requiredInputs,
        exitCriteria: section.exitCriteria,
        minEvidence: section.minEvidence,
        minWords: section.minWords,
        standardId: pack.standardId,
        standardVersion: pack.standardVersion,
      });
    }
  }

  if (!artifacts.length) {
    throw new Error('Unable to compile process plan: no artifacts resolved.');
  }

  const orderedNodes = topologicalOrder(nodes);
  const mode = resolveMode({
    requestMode: normalizeRequestMode(input.requestMode),
    artifactsCount: artifacts.length,
    hasSectionSubset: artifacts.some((artifact) => Array.isArray(artifact.requestedSections) && artifact.requestedSections.length > 0),
  });

  const normalizedPlan: Omit<CompiledProcessPlan, 'planHash'> = {
    version: 'phase2.v1',
    mode,
    rootObjective: objective,
    primaryArtifactType: artifacts[0].artifactType,
    artifacts: artifacts.map((artifact) => ({
      artifactKey: artifact.artifactKey,
      artifactType: artifact.artifactType,
      objective: artifact.objective,
      requestedSections: artifact.requestedSections,
      selectedSections: artifact.selectedSections,
      standardId: artifact.standardId,
      standardVersion: artifact.standardVersion,
      professorMethod: artifact.professorMethod,
    })),
    sections: orderedNodes.map((node) => ({
      nodeId: node.nodeId,
      artifactKey: node.artifactKey,
      artifactType: node.artifactType,
      sectionKey: node.sectionKey,
      title: node.title,
      framework: node.framework,
      order: node.order,
      dependsOnNodeIds: node.dependsOnNodeIds,
      requiredInputs: node.requiredInputs,
      exitCriteria: node.exitCriteria,
      minEvidence: node.minEvidence,
      minWords: node.minWords,
      standardId: node.standardId,
      standardVersion: node.standardVersion,
    })),
  };

  const planHash = crypto
    .createHash('sha256')
    .update(deterministicStringify(normalizedPlan))
    .digest('hex');

  return {
    ...normalizedPlan,
    planHash,
  };
}

export function readPlanFromMetadata(metadata: unknown): CompiledProcessPlan | null {
  const root = asRecord(metadata);
  const phase2 = asRecord(root.phase2);
  const candidate = asRecord(phase2.plan);
  if (!candidate || candidate.version !== 'phase2.v1') return null;

  try {
    const compiled = compileProcessPlan({
      objective: normalizeText(candidate.rootObjective) || 'Build strategy deliverables',
      requestMode: normalizeText(candidate.mode) || undefined,
      targets: Array.isArray(candidate.artifacts)
        ? candidate.artifacts.map((entry) => {
            const item = asRecord(entry);
            return {
              artifactType: normalizeText(item.artifactType),
              sections: Array.isArray(item.requestedSections)
                ? item.requestedSections.map((value) => normalizeText(value)).filter(Boolean)
                : undefined,
              objective: normalizeText(item.objective) || undefined,
            };
          })
        : undefined,
    });

    if (normalizeText((candidate as Record<string, unknown>).planHash) === compiled.planHash) {
      return compiled;
    }
    return compiled;
  } catch {
    return null;
  }
}
