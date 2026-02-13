/**
 * @deprecated Legacy dashboard view kept for backwards compatibility while BAT workspace rollout completes.
 * Use /research/[id] BAT modules instead.
 */
'use client';

import { useState } from 'react';
import { Search, Image, Users, Brain, Database, MessageSquare, Layers, User, ChevronDown, ChevronRight } from 'lucide-react';
import { mockResearchData } from '@/data/mock-data';
import { ClientHeader } from './ClientHeader';
import { PipelineProgress } from './PipelineProgress';
import { RawSearchResults } from './RawSearchResults';
import { MediaGrid } from './MediaGrid';
import { CompetitorRecon } from './CompetitorRecon';
import { CommunityInsights } from './CommunityInsights';
import { AiAnalysisPanel } from './AiAnalysisPanel';
import { PersonaCards } from './PersonaCards';
import { ContentPillars } from './ContentPillars';
import { cn } from '@/lib/utils';

interface SectionProps {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}

function Section({ title, icon: Icon, children, defaultOpen = true, badge }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="space-y-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 w-full text-left group"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 group-hover:bg-muted transition-colors">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h2 className="text-lg font-semibold flex-1">{title}</h2>
        {badge && (
          <span className="text-xs text-muted-foreground font-mono px-2 py-0.5 bg-muted/50 rounded">
            {badge}
          </span>
        )}
        {isOpen ? (
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        )}
      </button>
      <div
        className={cn(
          "transition-all duration-300 overflow-hidden",
          isOpen ? "opacity-100" : "opacity-0 h-0"
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function BrandStrategyDashboard() {
  const data = mockResearchData;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <ClientHeader client={data.client} job={data.job} />
      
      {/* Pipeline Progress */}
      <PipelineProgress job={data.job} />

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8 space-y-10">
        
        {/* Stage 1: Raw Intelligence */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
            <span className="text-xs font-mono text-muted-foreground px-3 py-1 bg-muted/30 rounded-full">
              STAGE 1 · RAW INTELLIGENCE
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section 
              title="Raw Search Results" 
              icon={Search}
              badge={`${data.rawSearchResults.length} results`}
            >
              <RawSearchResults results={data.rawSearchResults} />
            </Section>

            <Section 
              title="Social Reconnaissance" 
              icon={Users}
              badge={`${data.competitors.length} competitors`}
            >
              <CompetitorRecon competitors={data.competitors} />
            </Section>
          </div>

          <Section 
            title="Media Findings" 
            icon={Image}
            badge={`${data.imageResults.length + data.videoResults.length} assets`}
          >
            <MediaGrid images={data.imageResults} videos={data.videoResults} />
          </Section>
        </div>

        {/* Stage 2: Ingested Assets */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
            <span className="text-xs font-mono text-muted-foreground px-3 py-1 bg-muted/30 rounded-full">
              STAGE 2 · PROCESSED INSIGHTS
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
          </div>

          <Section 
            title="Community Insights" 
            icon={MessageSquare}
            badge={`${data.communityInsights.length} insights`}
          >
            <CommunityInsights insights={data.communityInsights} />
          </Section>
        </div>

        {/* Stage 3: Strategic Output */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            <span className="text-xs font-mono text-primary px-3 py-1 bg-primary/10 rounded-full border border-primary/20">
              STAGE 3 · STRATEGIC OUTPUT
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
          </div>

          <Section 
            title="AI Business Analysis" 
            icon={Brain}
          >
            <AiAnalysisPanel analysis={data.aiAnalysis} />
          </Section>

          <Section 
            title="Target Personas" 
            icon={User}
            badge={`${data.personas.length} personas`}
          >
            <PersonaCards personas={data.personas} />
          </Section>

          <Section 
            title="Content Pillars" 
            icon={Layers}
            badge={`${data.contentPillars.length} pillars`}
          >
            <ContentPillars pillars={data.contentPillars} />
          </Section>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30 py-6">
        <div className="container mx-auto px-6 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Database className="h-3.5 w-3.5" />
            <span>Brand Strategy Intelligence Platform</span>
          </div>
          <div className="font-mono">
            Job ID: {data.job.id} · Last updated: {new Date().toLocaleString()}
          </div>
        </div>
      </footer>
    </div>
  );
}
