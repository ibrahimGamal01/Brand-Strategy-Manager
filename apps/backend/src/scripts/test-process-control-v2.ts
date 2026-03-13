import assert from 'node:assert/strict';
import { assertStageTransition } from '../services/process-control/constants';
import { selectMethod, selectMethodV2 } from '../services/process-control/policy';
import { BUSINESS_STRATEGY_RUBRIC } from '../services/process-control/rubric-business-strategy';
import { buildLinkedinActorQueries } from '../services/process-control/research-adapter';
import { evaluateSectionPolicyGates, summarizeGateEvaluations } from '../services/process-control/quality-gates';
import { compileProcessPlan, readPlanFromMetadata } from '../services/process-control/request-compiler';
import { listBusinessStrategyCoreSectionKeys, listBusinessStrategyNichePacks } from '../services/process-control/standards-registry';
import { parseQuestionAnswerContract } from '../services/process-control/contracts';

async function main() {
  const highConfidence = selectMethod({
    businessState: {
      niche: 'B2B SaaS workflow automation for clinics',
      businessType: 'SaaS',
      website: 'example.com',
      hasCompetitors: true,
    },
    objective: 'Improve conversion and retention',
    nicheConfidence: 0.82,
  });
  assert.equal(highConfidence.method, 'NICHE_STANDARD');
  assert.match(highConfidence.ruleId, /niche_standard_if_confident/);

  const fallback = selectMethod({
    businessState: {
      niche: '',
      businessType: '',
      website: '',
      hasCompetitors: false,
    },
    objective: 'generic marketing plan',
    nicheConfidence: 0.12,
  });
  assert.equal(fallback.method, 'BAT_CORE');
  assert.match(fallback.ruleId, /fallback_bat_core/);

  const v2Single = selectMethodV2({
    businessState: {
      niche: 'Wellness clinics',
      businessType: 'Agency',
      website: 'example.com',
      hasCompetitors: true,
    },
    objective: 'Scale customer acquisition',
    nicheConfidence: 0.74,
    context: {
      requestMode: 'single_doc',
      artifactTypes: ['BUSINESS_STRATEGY'],
    },
  });
  assert.equal(v2Single.method, 'NICHE_STANDARD');
  assert.match(v2Single.ruleId, /phase2\/single_doc/);

  const v2Composite = selectMethodV2({
    businessState: {
      niche: '',
      businessType: '',
      website: '',
      hasCompetitors: false,
    },
    objective: 'multi deliverable plan',
    nicheConfidence: 0.2,
    context: {
      requestMode: 'multi_doc_bundle',
      artifactTypes: ['BUSINESS_STRATEGY', 'COMPETITOR_AUDIT'],
    },
  });
  assert.equal(v2Composite.method, 'BAT_CORE');
  assert.match(v2Composite.ruleId, /phase2\/composite/);

  const compiled = compileProcessPlan({
    objective: 'Create strategy plus competitor audit',
    requestMode: 'multi_doc_bundle',
    targets: [
      { artifactType: 'BUSINESS_STRATEGY', sections: ['execution_roadmap'] },
      { artifactType: 'COMPETITOR_AUDIT' },
    ],
  });
  assert.equal(compiled.mode, 'multi_doc_bundle');
  assert.equal(compiled.artifacts.length, 2);
  assert.ok(compiled.planHash.length >= 32);
  assert.ok(compiled.sections.some((section) => section.artifactType === 'BUSINESS_STRATEGY'));
  assert.ok(compiled.sections.some((section) => section.sectionKey === 'execution_roadmap'));
  assert.ok(
    compiled.sections.some(
      (section) =>
        section.artifactType === 'BUSINESS_STRATEGY' && section.sectionKey === 'go_to_market_execution'
    )
  );

  const coreSectionKeys = listBusinessStrategyCoreSectionKeys();
  const nichePacks = listBusinessStrategyNichePacks();
  assert.ok(coreSectionKeys.length >= 8);
  assert.ok(nichePacks.length >= 1);
  const firstNichePack = nichePacks[0];
  assert.ok(firstNichePack.sectionKeys.length >= 1);
  const corePlusNiche = compileProcessPlan({
    objective: 'Scale this SaaS product',
    requestMode: 'section_bundle',
    targets: [
      {
        artifactType: 'BUSINESS_STRATEGY',
        sections: [...coreSectionKeys, ...firstNichePack.sectionKeys],
      },
    ],
  });
  for (const sectionKey of coreSectionKeys) {
    assert.ok(
      corePlusNiche.sections.some(
        (section) =>
          section.artifactType === 'BUSINESS_STRATEGY' && section.sectionKey === sectionKey
      )
    );
  }
  for (const sectionKey of firstNichePack.sectionKeys) {
    assert.ok(
      corePlusNiche.sections.some(
        (section) =>
          section.artifactType === 'BUSINESS_STRATEGY' && section.sectionKey === sectionKey
      )
    );
  }

  const hydratedPlan = readPlanFromMetadata({
    phase2: {
      requestMode: compiled.mode,
      planHash: compiled.planHash,
      plan: compiled,
    },
  });
  assert.ok(hydratedPlan);
  assert.equal(hydratedPlan?.planHash, compiled.planHash);

  const textAnswerContract = parseQuestionAnswerContract({ answerText: 'English' });
  assert.equal(textAnswerContract.answer, 'English');
  const singleSelectContract = parseQuestionAnswerContract({ selectedOption: '90_days' });
  assert.equal(singleSelectContract.answer, '90_days');
  const multiSelectContract = parseQuestionAnswerContract({ selectedOptions: ['instagram', 'linkedin'] });
  assert.deepEqual(multiSelectContract.answer, ['instagram', 'linkedin']);

  const linkedinQueries = buildLinkedinActorQueries({
    actorName: 'Ali Brand',
    brandShortName: 'Ali',
    brandDomain: 'https://alibrand.com',
  });
  assert.ok(linkedinQueries.length > 0);
  for (const query of linkedinQueries) {
    assert.match(query, /site:linkedin\.com/i);
    assert.ok(!query.includes('https://'));
    assert.ok(!query.includes('http://'));
  }

  const rubric = BUSINESS_STRATEGY_RUBRIC[0];
  const failedGates = evaluateSectionPolicyGates({
    section: rubric,
    markdown: 'Claim: TBD',
    availableInputs: {},
    evidenceCount: 0,
    latestEvidenceAt: null,
  });
  const failedSummary = summarizeGateEvaluations(failedGates);
  assert.equal(failedSummary.passed, false);
  assert.equal(failedSummary.shouldEscalate, true);

  const passedGates = evaluateSectionPolicyGates({
    section: rubric,
    markdown:
      'Claim: This section supports growth with evidence-backed context.\n' +
      'Analysis: The strategy uses a clear audience lens, measurable objective alignment, and explicit delivery cadence. '.repeat(10) +
      'Recommendation: Execute weekly review checkpoints, adjust decisions by evidence quality, and escalate unresolved risks.',
    availableInputs: {
      primaryGoal: 'Grow qualified leads',
      oneSentenceDescription: 'We help clinics automate operations.',
      targetAudience: 'Small clinics',
    },
    evidenceCount: rubric.minEvidence,
    latestEvidenceAt: new Date(),
  });
  const passedSummary = summarizeGateEvaluations(passedGates);
  assert.equal(passedSummary.passed, true);

  assert.doesNotThrow(() => assertStageTransition('INTAKE_READY', 'METHOD_SELECTED'));
  assert.doesNotThrow(() => assertStageTransition('SECTION_VALIDATING', 'COMPOSING'));

  let threw = false;
  try {
    assertStageTransition('INTAKE_READY', 'READY');
  } catch {
    threw = true;
  }
  assert.equal(threw, true);

  console.log('process-control-v2 tests passed');
}

void main().catch((error) => {
  console.error('process-control-v2 tests failed:', error);
  process.exit(1);
});
