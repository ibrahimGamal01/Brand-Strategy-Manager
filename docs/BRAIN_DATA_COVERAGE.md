# Brain Data Coverage: Form → Storage → BrainProfile

This document describes the mapping from the client intake form, through `buildIntakePayload` and `processBrainIntake`, into `ResearchJob.inputData`, and finally into `BrainProfile` via the sync.

## Data Flow Overview

```
Intake Form (business-context-fields.tsx)
    → buildIntakePayload (page.tsx)
    → processBrainIntake (brain-intake.ts)
    → ResearchJob.inputData + BrainProfile (upsertBrainProfile)
    → syncInputDataToBrainProfile (sync-input-to-brain-profile.ts)
    → BrainProfile (when sync/backfill runs)
```

## Form Field → buildIntakePayload Key → inputData Key → BrainProfile Column

| Form Label | Form State Key | buildIntakePayload Key | inputData Key | BrainProfile Column |
|------------|----------------|------------------------|---------------|---------------------|
| Brand Name | `name` | `name` | `brandName` | (used for Client.name) |
| Website | `website` | `website` | `website` | `websiteDomain` |
| What do you do in one sentence? | `oneSentenceDescription` | `oneSentenceDescription` | `description`, `businessOverview` | (falls back to businessType/offerModel if empty) |
| Niche / Industry | `niche` | `niche` | `niche` | (merged into businessType) |
| Business Type | `businessType` | `businessType` | `businessType` | `businessType` |
| Where do you operate? | `operateWhere` | `operateWhere` | `operateWhere` | `geoScope` (combined with wantClientsWhere) |
| Where do you want more clients? | `wantClientsWhere` | `wantClientsWhere` | `wantClientsWhere` | `geoScope` |
| Ideal audience | `idealAudience` | `idealAudience` | `idealAudience` | `targetMarket` |
| Target Audience (general) | `targetAudience` | `targetAudience` | `targetAudience` | `targetMarket` |
| Geo Scope | `geoScope` | `geoScope` | `geoScope` | `geoScope` |
| Services (list) | `servicesList` | `servicesList` (parsed) | `servicesList` | (in constraints / context) |
| Main offer | `mainOffer` | `mainOffer` | `mainOffer` | `offerModel` |
| Primary Goal | `primaryGoal` | `primaryGoal` | `primaryGoal` | `primaryGoal` |
| Secondary Goals | `secondaryGoals` | `secondaryGoals` (parsed) | `secondaryGoals` | `secondaryGoals` (JSON) + BrainGoal |
| Future Business Goal | `futureGoal` | `futureGoal` | — | (used in businessOverview fallback) |
| Why Join The Marketing AI Engine | `engineGoal` | `engineGoal` | (in constraints) | (in constraints.operatorGoal) |
| Top 3 problems | `topProblems` | `topProblems` (parsed) | `topProblems` | (in constraints / context) |
| Results in next 90 days | `resultsIn90Days` | `resultsIn90Days` (parsed) | `resultsIn90Days` | (fallback for primaryGoal) |
| Questions before buying | `questionsBeforeBuying` | `questionsBeforeBuying` (parsed) | `questionsBeforeBuying` | (in constraints / context) |
| Brand voice (3–5 words) | `brandVoiceWords` | `brandVoiceWords` | `brandVoiceWords` | constraints.brandVoiceWords |
| Brand Tone | `brandTone` | `brandTone` | `brandTone` | constraints.brandTone |
| Topics to avoid | `topicsToAvoid` | `topicsToAvoid` | `topicsToAvoid` | constraints.topicsToAvoid |
| Constraints | `constraints` | `constraints` (nested) | `constraints` | constraints.businessConstraints |
| Excluded Categories | `excludedCategories` | `excludedCategories` (parsed) | (in constraints) | constraints.excludedCategories |
| Social Handles | `handles` | `channels`, `handles` | `channels`, `handles` | `channels` (JSON) |
| Competitor inspiration links | `competitorInspirationLinks` | `competitorInspirationLinks` (parsed) | `competitorInspirationLinks` | (used for discovery) |
| Language | `language` | `language` | `language` | constraints.language |
| Planning Horizon | `planningHorizon` | `planningHorizon` | `planningHorizon` | constraints.planningHorizon |
| Autonomy Level | `autonomyLevel` | `autonomyLevel` | `autonomyLevel` | constraints.autonomyLevel |
| Budget Sensitivity | `budgetSensitivity` | `budgetSensitivity` | `budgetSensitivity` | constraints.budgetSensitivity |

## Sync Key Aliases (Alternate Import Keys)

The sync (`sync-input-to-brain-profile.ts`) supports alternate keys for imported data (spreadsheet, manual SQL, alternate forms):

| Canonical Key | Aliases |
|---------------|---------|
| `primaryGoal` | `resultsIn90Days`, `goal`, `goals` |
| `businessType` | `niche`, `type`, `business_type` |
| `targetAudience` | `idealAudience`, `audience`, `ideal_audience` |
| `mainOffer` | `offer`, `main_offer`, `offerModel`, `engineGoal` |
| `description` | `businessOverview`, `oneSentenceDescription` |
| `website` | `websiteDomain`, `url`, `domain` |

## Client Fallbacks

When `syncInputDataToBrainProfile` runs, it merges:

- `Client.businessOverview` → `description`, `businessOverview`
- `Client.goalsKpis` → `primaryGoal`
- `ClientAccount[]` → `channels` (platform, handle)

## Diagnostic Endpoint

`GET /api/research-jobs/:id/debug-brain` returns:

- `inputData`: raw job inputData
- `brainProfile`: current BrainProfile for the client
- `clientFallbacks`: businessOverview, goalsKpis, clientAccounts
- `syncWouldRun`: whether `hasMeaningfulInputData` is true
- `keysFound`: which expected/alias keys exist in inputData
- `inputDataKeys`: full list of keys in inputData
