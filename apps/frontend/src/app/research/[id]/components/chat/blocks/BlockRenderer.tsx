import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type {
  ChatBlock,
  TableBlock,
  MetricCardsBlock,
  InsightBlock,
  PostGridBlock,
  ComparisonBlock,
  SourceListBlock,
  ActionButtonsBlock,
  TimelineBlock,
  FunnelBlock,
  ChartBlock,
  PollBlock,
  ScoreboardBlock,
  MoodboardBlock,
  SwotBlock,
  BrandVoiceMeterBlock,
  ProgressStepperBlock,
  GuidedQuestionCardBlock,
  ChoiceChipsBlock,
  OptionCardsBlock,
  RecapEditorBlock,
  QuickReplyBarBlock,
  EvidenceListBlock,
  MutationPreviewBlock,
  DocumentRequestBlock,
  DocumentReadyBlock,
  CompareModesBlock,
  ScenarioSimulatorBlock,
  ConstraintBuilderBlock,
  ExamplesGalleryBlock,
  TradeoffMatrixBlock,
  DraftPreviewCardBlock,
  ConfidenceCheckBlock,
} from './types';
import { TableBlockView } from './renderers/TableBlockView';
import { MetricCardsBlockView } from './renderers/MetricCardsBlockView';
import { InsightBlockView } from './renderers/InsightBlockView';
import { PostGridBlockView } from './renderers/PostGridBlockView';
import { ComparisonBlockView } from './renderers/ComparisonBlockView';
import { SourceListBlockView } from './renderers/SourceListBlockView';
import { ActionButtonsBlockView } from './renderers/ActionButtonsBlockView';
import { TimelineBlockView } from './renderers/TimelineBlockView';
import { FunnelBlockView } from './renderers/FunnelBlockView';
import { ChartBlockView } from './renderers/ChartBlockView';
import { PollBlockView } from './renderers/PollBlockView';
import { ScoreboardBlockView } from './renderers/ScoreboardBlockView';
import { MoodboardBlockView } from './renderers/MoodboardBlockView';
import { SwotBlockView } from './renderers/SwotBlockView';
import { BrandVoiceMeterBlockView } from './renderers/BrandVoiceMeterBlockView';
import { ClarificationBlockView } from './renderers/ClarificationBlockView';
import { ProgressStepperBlockView } from './renderers/ProgressStepperBlockView';
import { GuidedQuestionCardBlockView } from './renderers/GuidedQuestionCardBlockView';
import { ChoiceChipsBlockView } from './renderers/ChoiceChipsBlockView';
import { OptionCardsBlockView } from './renderers/OptionCardsBlockView';
import { RecapEditorBlockView } from './renderers/RecapEditorBlockView';
import { QuickReplyBarBlockView } from './renderers/QuickReplyBarBlockView';
import { EvidenceListBlockView } from './renderers/EvidenceListBlockView';
import { MutationPreviewBlockView } from './renderers/MutationPreviewBlockView';
import { DocumentRequestBlockView } from './renderers/DocumentRequestBlockView';
import { DocumentReadyBlockView } from './renderers/DocumentReadyBlockView';
import { CompareModesBlockView } from './renderers/CompareModesBlockView';
import { ScenarioSimulatorBlockView } from './renderers/ScenarioSimulatorBlockView';
import { ConstraintBuilderBlockView } from './renderers/ConstraintBuilderBlockView';
import { ExamplesGalleryBlockView } from './renderers/ExamplesGalleryBlockView';
import { TradeoffMatrixBlockView } from './renderers/TradeoffMatrixBlockView';
import { DraftPreviewCardBlockView } from './renderers/DraftPreviewCardBlockView';
import { ConfidenceCheckBlockView } from './renderers/ConfidenceCheckBlockView';

// Type guards
const isTableBlock = (b: ChatBlock): b is TableBlock => b.type === 'table';
const isMetricCardsBlock = (b: ChatBlock): b is MetricCardsBlock => b.type === 'metric_cards';
const isInsightBlock = (b: ChatBlock): b is InsightBlock => b.type === 'insight';
const isPostGridBlock = (b: ChatBlock): b is PostGridBlock => b.type === 'post_grid';
const isComparisonBlock = (b: ChatBlock): b is ComparisonBlock => b.type === 'comparison';
const isSourceListBlock = (b: ChatBlock): b is SourceListBlock => b.type === 'source_list';
const isActionButtonsBlock = (b: ChatBlock): b is ActionButtonsBlock => b.type === 'action_buttons';
const isTimelineBlock = (b: ChatBlock): b is TimelineBlock => b.type === 'timeline';
const isFunnelBlock = (b: ChatBlock): b is FunnelBlock => b.type === 'funnel';
const isChartBlock = (b: ChatBlock): b is ChartBlock => b.type === 'chart';
const isPollBlock = (b: ChatBlock): b is PollBlock => b.type === 'poll';
const isScoreboardBlock = (b: ChatBlock): b is ScoreboardBlock => b.type === 'scoreboard';
const isMoodboardBlock = (b: ChatBlock): b is MoodboardBlock => b.type === 'moodboard';
const isSwotBlock = (b: ChatBlock): b is SwotBlock => b.type === 'swot';
const isBrandVoiceMeterBlock = (b: ChatBlock): b is BrandVoiceMeterBlock => b.type === 'brand_voice_meter';
const isProgressStepperBlock = (b: ChatBlock): b is ProgressStepperBlock => b.type === 'progress_stepper';
const isGuidedQuestionCardBlock = (b: ChatBlock): b is GuidedQuestionCardBlock => b.type === 'guided_question_card';
const isChoiceChipsBlock = (b: ChatBlock): b is ChoiceChipsBlock => b.type === 'choice_chips';
const isOptionCardsBlock = (b: ChatBlock): b is OptionCardsBlock => b.type === 'option_cards';
const isRecapEditorBlock = (b: ChatBlock): b is RecapEditorBlock => b.type === 'recap_editor';
const isQuickReplyBarBlock = (b: ChatBlock): b is QuickReplyBarBlock => b.type === 'quick_reply_bar';
const isEvidenceListBlock = (b: ChatBlock): b is EvidenceListBlock => b.type === 'evidence_list';
const isMutationPreviewBlock = (b: ChatBlock): b is MutationPreviewBlock => b.type === 'mutation_preview';
const isDocumentRequestBlock = (b: ChatBlock): b is DocumentRequestBlock => b.type === 'document_request';
const isDocumentReadyBlock = (b: ChatBlock): b is DocumentReadyBlock => b.type === 'document_ready';
const isCompareModesBlock = (b: ChatBlock): b is CompareModesBlock => b.type === 'compare_modes';
const isScenarioSimulatorBlock = (b: ChatBlock): b is ScenarioSimulatorBlock => b.type === 'scenario_simulator';
const isConstraintBuilderBlock = (b: ChatBlock): b is ConstraintBuilderBlock => b.type === 'constraint_builder';
const isExamplesGalleryBlock = (b: ChatBlock): b is ExamplesGalleryBlock => b.type === 'examples_gallery';
const isTradeoffMatrixBlock = (b: ChatBlock): b is TradeoffMatrixBlock => b.type === 'tradeoff_matrix';
const isDraftPreviewCardBlock = (b: ChatBlock): b is DraftPreviewCardBlock => b.type === 'draft_preview_card';
const isConfidenceCheckBlock = (b: ChatBlock): b is ConfidenceCheckBlock => b.type === 'confidence_check';
// Inline type for ClarificationBlock
interface ClarificationBlock {
  type: 'clarification';
  blockId: string;
  question: string;
  options: string[];
  allowFreeText?: boolean;
}

const isClarificationBlock = (b: ChatBlock): b is ClarificationBlock & ChatBlock =>
  b.type === 'clarification';

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeBlock(block: ChatBlock): ChatBlock {
  const source = (block && typeof block === 'object' ? block : {}) as Record<string, unknown>;
  const type = asString(source.type, 'unknown');
  const blockId = asString(source.blockId, `block-${type || 'unknown'}`);
  const out: Record<string, unknown> = { ...source, type, blockId };

  switch (type) {
    case 'table':
      out.columns = asArray<string>(out.columns);
      out.rows = asArray<Record<string, unknown>>(out.rows);
      break;
    case 'metric_cards':
      out.cards = asArray<Record<string, unknown>>(out.cards);
      break;
    case 'post_grid':
      out.postIds = asArray<string>(out.postIds);
      break;
    case 'comparison':
      out.left = typeof out.left === 'object' && out.left ? out.left : {};
      out.right = typeof out.right === 'object' && out.right ? out.right : {};
      (out.left as any).items = asArray<string>((out.left as any).items);
      (out.right as any).items = asArray<string>((out.right as any).items);
      break;
    case 'source_list':
      out.sources = asArray<Record<string, unknown>>(out.sources);
      break;
    case 'action_buttons':
      out.buttons = asArray<Record<string, unknown>>(out.buttons);
      break;
    case 'timeline':
      out.steps = asArray<Record<string, unknown>>(out.steps);
      break;
    case 'funnel':
      out.stages = asArray<Record<string, unknown>>(out.stages);
      break;
    case 'chart':
      out.series = asArray<Record<string, unknown>>(out.series);
      break;
    case 'poll':
      out.options = asArray<Record<string, unknown>>(out.options);
      break;
    case 'scoreboard':
      out.rows = asArray<Record<string, unknown>>(out.rows);
      break;
    case 'moodboard':
      out.palette = asArray<Record<string, unknown>>(out.palette);
      out.fonts = asArray<Record<string, unknown>>(out.fonts);
      out.keywords = asArray<string>(out.keywords);
      break;
    case 'swot':
      out.strengths = asArray<string>(out.strengths);
      out.weaknesses = asArray<string>(out.weaknesses);
      out.opportunities = asArray<string>(out.opportunities);
      out.threats = asArray<string>(out.threats);
      break;
    case 'brand_voice_meter':
      out.dimensions = asArray<Record<string, unknown>>(out.dimensions);
      break;
    case 'clarification':
      out.options = asArray<string>(out.options);
      break;
    case 'guided_question_card':
      out.options = asArray<Record<string, unknown>>(out.options);
      break;
    case 'choice_chips':
      out.choices = asArray<Record<string, unknown>>(out.choices);
      break;
    case 'option_cards':
      out.cards = asArray<Record<string, unknown>>(out.cards).map((card) => ({
        ...card,
        tags: asArray<string>((card as any).tags),
      }));
      break;
    case 'recap_editor':
      out.items = asArray<Record<string, unknown>>(out.items);
      break;
    case 'quick_reply_bar':
      out.suggestions = asArray<string>(out.suggestions);
      break;
    case 'evidence_list':
      out.items = asArray<Record<string, unknown>>(out.items);
      break;
    case 'mutation_preview':
      out.warnings = asArray<string>(out.warnings);
      out.beforeSample = asArray<Record<string, unknown>>(out.beforeSample);
      out.afterSample = asArray<Record<string, unknown>>(out.afterSample);
      break;
    case 'document_request':
      out.options = asArray<Record<string, unknown>>(out.options);
      break;
    case 'compare_modes':
      out.modes = asArray<Record<string, unknown>>(out.modes).map((mode) => ({
        ...mode,
        pros: asArray<string>((mode as any).pros),
        cons: asArray<string>((mode as any).cons),
      }));
      break;
    case 'scenario_simulator':
      out.scenarios = asArray<Record<string, unknown>>(out.scenarios);
      break;
    case 'constraint_builder':
      out.constraints = asArray<Record<string, unknown>>(out.constraints);
      break;
    case 'examples_gallery':
      out.examples = asArray<Record<string, unknown>>(out.examples);
      break;
    case 'tradeoff_matrix':
      out.criteria = asArray<string>(out.criteria);
      out.options = asArray<Record<string, unknown>>(out.options).map((option) => ({
        ...option,
        scores: asArray<number>((option as any).scores),
      }));
      break;
    case 'draft_preview_card':
      out.checks = asArray<string>(out.checks);
      break;
    case 'confidence_check':
      out.options = asArray<string>(out.options);
      break;
    default:
      break;
  }

  return out as ChatBlock;
}

function hasRenderableContent(block: ChatBlock): boolean {
  const type = String(block.type || '').toLowerCase();
  switch (type) {
    case 'insight':
      return hasText((block as InsightBlock).title) || hasText((block as InsightBlock).body);
    case 'table':
      return asArray((block as TableBlock).columns).length > 0 && asArray((block as TableBlock).rows).length > 0;
    case 'metric_cards':
      return asArray((block as MetricCardsBlock).cards).length > 0;
    case 'post_grid':
      return asArray((block as PostGridBlock).postIds).length > 0;
    case 'source_list':
      return asArray((block as SourceListBlock).sources).length > 0;
    case 'action_buttons':
      return asArray((block as ActionButtonsBlock).buttons).length > 0;
    case 'timeline':
      return asArray((block as TimelineBlock).steps).length > 0;
    case 'funnel':
      return asArray((block as FunnelBlock).stages).length > 0;
    case 'chart':
      return asArray((block as ChartBlock).series).length > 0;
    case 'poll':
      return asArray((block as PollBlock).options).length > 0;
    case 'scoreboard':
      return asArray((block as ScoreboardBlock).rows).length > 0;
    case 'moodboard':
      return (
        asArray((block as MoodboardBlock).palette).length > 0 ||
        asArray((block as MoodboardBlock).fonts).length > 0 ||
        asArray((block as MoodboardBlock).keywords).length > 0
      );
    case 'swot': {
      const swot = block as SwotBlock;
      return (
        asArray(swot.strengths).length > 0 ||
        asArray(swot.weaknesses).length > 0 ||
        asArray(swot.opportunities).length > 0 ||
        asArray(swot.threats).length > 0
      );
    }
    case 'brand_voice_meter':
      return asArray((block as BrandVoiceMeterBlock).dimensions).length > 0;
    case 'guided_question_card':
      return hasText((block as GuidedQuestionCardBlock).question) || asArray((block as GuidedQuestionCardBlock).options).length > 0;
    case 'choice_chips':
      return hasText((block as ChoiceChipsBlock).prompt) || asArray((block as ChoiceChipsBlock).choices).length > 0;
    case 'option_cards':
      return hasText((block as OptionCardsBlock).prompt) || asArray((block as OptionCardsBlock).cards).length > 0;
    case 'recap_editor':
      return asArray((block as RecapEditorBlock).items).length > 0 || hasText((block as RecapEditorBlock).summary);
    case 'quick_reply_bar':
      return asArray((block as QuickReplyBarBlock).suggestions).length > 0;
    case 'evidence_list':
      return asArray((block as EvidenceListBlock).items).length > 0;
    case 'mutation_preview':
      return typeof (block as MutationPreviewBlock).matchedCount === 'number';
    case 'document_request':
      return asArray((block as DocumentRequestBlock).options).length > 0 || hasText((block as DocumentRequestBlock).question);
    case 'document_ready':
      return hasText((block as DocumentReadyBlock).storagePath) || hasText((block as DocumentReadyBlock).title);
    case 'compare_modes':
      return asArray((block as CompareModesBlock).modes).length > 0;
    case 'scenario_simulator':
      return asArray((block as ScenarioSimulatorBlock).scenarios).length > 0;
    case 'constraint_builder':
      return asArray((block as ConstraintBuilderBlock).constraints).length > 0;
    case 'examples_gallery':
      return asArray((block as ExamplesGalleryBlock).examples).length > 0;
    case 'tradeoff_matrix':
      return asArray((block as TradeoffMatrixBlock).options).length > 0;
    case 'draft_preview_card':
      return hasText((block as DraftPreviewCardBlock).preview);
    case 'confidence_check':
      return hasText((block as ConfidenceCheckBlock).assumption);
    default:
      return true;
  }
}

interface BlockRendererProps {
  block: ChatBlock;
  isPinned?: boolean;
  onView?: (block: ChatBlock) => void;
  onPin?: (block: ChatBlock) => void;
  onUnpin?: (block: ChatBlock) => void;
  onAction?: (action?: string, href?: string, payload?: Record<string, unknown>) => void;
  onClarify?: (answer: string) => void;
  onFormSubmit?: (block: ChatBlock, answer: string) => void;
}

export function BlockRenderer({
  block,
  isPinned,
  onView,
  onPin,
  onUnpin,
  onAction,
  onClarify,
  onFormSubmit,
}: BlockRendererProps) {
  const safeBlock = useMemo(() => normalizeBlock(block), [block]);
  const shouldRender = useMemo(() => hasRenderableContent(safeBlock), [safeBlock]);
  const ref = useRef<HTMLDivElement | null>(null);
  const viewedRef = useRef(false);
  const [, setHasViewed] = useState(false);
  const handleStructuredAnswer = (answer: string) => {
    onClarify?.(answer);
    onFormSubmit?.(safeBlock, answer);
  };

  useEffect(() => {
    if (!ref.current || viewedRef.current || !onView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !viewedRef.current) {
            viewedRef.current = true;
            setHasViewed(true);
            onView(safeBlock);
          }
        });
      },
      { threshold: 0.35 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [onView, safeBlock]);

  if (!shouldRender) {
    return null;
  }

  // Source list: render inline, no card wrapping
  if (isSourceListBlock(safeBlock)) {
    return (
      <div ref={ref}>
        <SourceListBlockView block={safeBlock} />
      </div>
    );
  }

  // Clarification: render inline, no pin
  if (isClarificationBlock(safeBlock)) {
    return (
      <div ref={ref}>
        <ClarificationBlockView
          block={safeBlock as ClarificationBlock}
          onAnswer={(answer: string) => handleStructuredAnswer(answer)}
        />
      </div>
    );
  }

  // All other blocks: render with pin button overlay (no outer wrapper card)
  return (
    <div
      ref={ref}
      className="group relative overflow-hidden rounded-2xl border border-border/40 bg-card/50 backdrop-blur-sm p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:border-emerald-500/30 hover:shadow-[0_8px_30px_rgb(16,185,129,0.08)]"
    >
      {/* Pin button - hover only */}
      <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
        {isPinned ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 rounded-full border border-amber-300/60 bg-amber-500/10 p-0 text-amber-600 hover:bg-amber-500/15"
            title="Unpin"
            onClick={() => onUnpin?.(safeBlock)}
          >
            📌
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 rounded-full border border-border/60 bg-background/70 p-0 text-muted-foreground/70 hover:border-primary/40 hover:text-foreground"
            title="Pin to saved"
            onClick={() => onPin?.(safeBlock)}
          >
            📌
          </Button>
        )}
      </div>

      {isTableBlock(safeBlock) && <TableBlockView block={safeBlock} />}
      {isMetricCardsBlock(safeBlock) && <MetricCardsBlockView block={safeBlock} />}
      {isInsightBlock(safeBlock) && <InsightBlockView block={safeBlock} />}
      {isPostGridBlock(safeBlock) && <PostGridBlockView block={safeBlock} />}
      {isComparisonBlock(safeBlock) && <ComparisonBlockView block={safeBlock} />}
      {isActionButtonsBlock(safeBlock) && <ActionButtonsBlockView block={safeBlock} onAction={onAction} />}
      {isTimelineBlock(safeBlock) && <TimelineBlockView block={safeBlock} />}
      {isFunnelBlock(safeBlock) && <FunnelBlockView block={safeBlock} />}
      {isChartBlock(safeBlock) && <ChartBlockView block={safeBlock} />}
      {isPollBlock(safeBlock) && <PollBlockView block={safeBlock} />}
      {isScoreboardBlock(safeBlock) && <ScoreboardBlockView block={safeBlock} />}
      {isMoodboardBlock(safeBlock) && <MoodboardBlockView block={safeBlock} />}
      {isSwotBlock(safeBlock) && <SwotBlockView block={safeBlock} />}
      {isBrandVoiceMeterBlock(safeBlock) && <BrandVoiceMeterBlockView block={safeBlock} />}
      {isProgressStepperBlock(safeBlock) && <ProgressStepperBlockView block={safeBlock} />}
      {isGuidedQuestionCardBlock(safeBlock) && <GuidedQuestionCardBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isChoiceChipsBlock(safeBlock) && <ChoiceChipsBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isOptionCardsBlock(safeBlock) && <OptionCardsBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isRecapEditorBlock(safeBlock) && <RecapEditorBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isQuickReplyBarBlock(safeBlock) && <QuickReplyBarBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isEvidenceListBlock(safeBlock) && <EvidenceListBlockView block={safeBlock} />}
      {isMutationPreviewBlock(safeBlock) && <MutationPreviewBlockView block={safeBlock} />}
      {isDocumentRequestBlock(safeBlock) && <DocumentRequestBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isDocumentReadyBlock(safeBlock) && <DocumentReadyBlockView block={safeBlock} />}
      {isCompareModesBlock(safeBlock) && <CompareModesBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isScenarioSimulatorBlock(safeBlock) && <ScenarioSimulatorBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isConstraintBuilderBlock(safeBlock) && <ConstraintBuilderBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isExamplesGalleryBlock(safeBlock) && <ExamplesGalleryBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isTradeoffMatrixBlock(safeBlock) && <TradeoffMatrixBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isDraftPreviewCardBlock(safeBlock) && <DraftPreviewCardBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}
      {isConfidenceCheckBlock(safeBlock) && <ConfidenceCheckBlockView block={safeBlock} onSelect={handleStructuredAnswer} />}

      {/* Unknown block type fallback */}
      {!isTableBlock(safeBlock) &&
        !isMetricCardsBlock(safeBlock) &&
        !isInsightBlock(safeBlock) &&
        !isPostGridBlock(safeBlock) &&
        !isComparisonBlock(safeBlock) &&
        !isActionButtonsBlock(safeBlock) &&
        !isTimelineBlock(safeBlock) &&
        !isFunnelBlock(safeBlock) &&
        !isChartBlock(safeBlock) &&
        !isPollBlock(safeBlock) &&
        !isScoreboardBlock(safeBlock) &&
        !isMoodboardBlock(safeBlock) &&
        !isSwotBlock(safeBlock) &&
        !isBrandVoiceMeterBlock(safeBlock) &&
        !isProgressStepperBlock(safeBlock) &&
        !isGuidedQuestionCardBlock(safeBlock) &&
        !isChoiceChipsBlock(safeBlock) &&
        !isOptionCardsBlock(safeBlock) &&
        !isRecapEditorBlock(safeBlock) &&
        !isQuickReplyBarBlock(safeBlock) &&
        !isEvidenceListBlock(safeBlock) &&
        !isMutationPreviewBlock(safeBlock) &&
        !isDocumentRequestBlock(safeBlock) &&
        !isDocumentReadyBlock(safeBlock) &&
        !isCompareModesBlock(safeBlock) &&
        !isScenarioSimulatorBlock(safeBlock) &&
        !isConstraintBuilderBlock(safeBlock) &&
        !isExamplesGalleryBlock(safeBlock) &&
        !isTradeoffMatrixBlock(safeBlock) &&
        !isDraftPreviewCardBlock(safeBlock) &&
        !isConfidenceCheckBlock(safeBlock) ? (
        <p className="text-xs text-muted-foreground">
          Unsupported block type: <span className="font-mono">{safeBlock.type}</span>
        </p>
      ) : null}
    </div>
  );
}
