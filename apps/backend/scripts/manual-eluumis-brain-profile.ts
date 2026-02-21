/**
 * Manually populate ELUUMIS BrainProfile with intake data.
 * Run: npx tsx -r dotenv/config scripts/manual-eluumis-brain-profile.ts
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

const ELUUMIS_CLIENT_ID = '6a3e399c-59d3-44af-880a-91ad5dea2320';

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: ELUUMIS_CLIENT_ID },
    include: { brainProfile: true, clientAccounts: true },
  });

  if (!client) {
    throw new Error('ELUUMIS client not found');
  }

  const businessType = 'Online wellness platform (biophoton-based light and sound experiences)';
  const offerModel =
    'A "first experience" entry point (free BioHealing Stream session), then conversion into a paid BioHealing Stream subscription, with an upsell path into ELUUMIS MATTER or ELUUMIS SKY programs/devices.';
  const primaryGoal =
    'BioHealing Stream subscribers growth (target 3,000 to 5,000); Book free sessions and capture emails for follow-up sequences';
  const secondaryGoals = [
    'Subscriber growth 3k–5k',
    'Book free sessions and capture emails',
  ];
  const targetMarket =
    'English-speaking wellness seekers (30 to 55) who are stressed, sleep-deprived, and tech-comfortable, open to biohacking and spiritual wellness, and want a simple at-home daily practice.';
  const geoScope =
    'Operate globally via 24/7 online streaming platform. Want more clients: US, Canada, UK, Australia, EU wellness audiences.';
  const websiteDomain = 'eluumis.com';

  const constraints = {
    brandVoiceWords: 'Calm, grounded, visionary, experiential, empowering',
    brandTone: 'Calm, grounded, visionary, experiential, empowering',
    topicsToAvoid: [
      'Medical diagnosis language and cure claims',
      'Fear-based wellness content and conspiracy framing',
      'Arguments about religion or politics',
      'Bargain-hunters who only want discounts and have low intent to commit to a daily practice',
    ],
  };

  const channels = (client.clientAccounts || []).map((a) => ({
    platform: a.platform,
    handle: a.handle,
  }));

  const oneSentence =
    'We deliver biophoton-based light and sound experiences through streaming and devices to support coherence, calm the nervous system, and improve overall wellbeing.';

  // Update Client fallbacks
  await prisma.client.update({
    where: { id: ELUUMIS_CLIENT_ID },
    data: {
      businessOverview: oneSentence,
      goalsKpis: primaryGoal,
    },
  });

  // Upsert BrainProfile
  const profile = await prisma.brainProfile.upsert({
    where: { clientId: ELUUMIS_CLIENT_ID },
    update: {
      businessType,
      offerModel,
      primaryGoal,
      secondaryGoals: secondaryGoals as any,
      targetMarket,
      geoScope,
      websiteDomain,
      channels: channels.length > 0 ? (channels as any) : [],
      constraints: constraints as any,
    },
    create: {
      clientId: ELUUMIS_CLIENT_ID,
      businessType,
      offerModel,
      primaryGoal,
      secondaryGoals: secondaryGoals as any,
      targetMarket,
      geoScope,
      websiteDomain,
      channels: channels.length > 0 ? (channels as any) : [],
      constraints: constraints as any,
    },
    include: { goals: true },
  });

  // Sync goals
  const { syncBrainGoals } = await import('../src/services/intake/brain-intake-utils');
  await syncBrainGoals(profile.id, primaryGoal, secondaryGoals);

  // Update ResearchJob inputData for any ELUUMIS jobs
  const jobs = await prisma.researchJob.findMany({
    where: { clientId: ELUUMIS_CLIENT_ID },
    select: { id: true, inputData: true },
  });

  const inputDataPayload = {
    ...((jobs[0]?.inputData as Record<string, unknown>) || {}),
    brandName: 'ELUUMIS',
    businessType,
    offerModel,
    primaryGoal,
    secondaryGoals,
    targetAudience: targetMarket,
    idealAudience: targetMarket,
    geoScope,
    website: websiteDomain,
    websiteDomain,
    description: oneSentence,
    businessOverview: oneSentence,
    operateWhere:
      'Globally via 24/7 online streaming platform and digital access through smart devices.',
    wantClientsWhere:
      'US, Canada, UK, Australia, EU wellness audiences',
    mainOffer: offerModel,
    servicesList: [
      'BioHealing Stream (always-on streaming experience)',
      'ELUUMIS SKY program + device',
      'ELUUMIS MATTER program + device',
      'Self-Healing program (classes, protocols, community)',
      'PRO program for practitioners',
    ],
    topProblems: [
      'Nervous system overload, stress, anxiety, dysregulation',
      'Poor sleep and recovery',
      'Low energy, feeling depleted, hard to stay centered',
    ],
    resultsIn90Days: [
      'BioHealing Stream subscribers growth (3k–5k)',
      'Book free sessions and capture emails',
    ],
    questionsBeforeBuying: [
      'How does it work, and what will I feel during a session?',
      'How quickly do people see results for sleep, stress, energy?',
      'What do I need to use it, phone/laptop setup, pricing, and support?',
    ],
    brandVoiceWords: constraints.brandVoiceWords,
    topicsToAvoid: constraints.topicsToAvoid,
    competitorInspirationLinks: [
      'https://www.instagram.com/giuliadallacostaa',
      'https://www.instagram.com/stephanie_lekkos',
      'https://www.instagram.com/quantum__manifestation',
    ],
    channels,
  };

  for (const job of jobs) {
    await prisma.researchJob.update({
      where: { id: job.id },
      data: { inputData: inputDataPayload as any },
    });
    console.log(`Updated inputData for job ${job.id}`);
  }

  console.log('\n[OK] ELUUMIS BrainProfile manually updated.');
  console.log('Profile:', {
    businessType,
    primaryGoal: primaryGoal.slice(0, 60) + '...',
    targetMarket: targetMarket.slice(0, 50) + '...',
    websiteDomain,
    secondaryGoalsCount: secondaryGoals.length,
    jobsUpdated: jobs.length,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
