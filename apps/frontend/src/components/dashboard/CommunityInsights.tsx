import { useState } from 'react';
import { MessageSquare, Code, ThumbsUp, ThumbsDown, Minus, Tag, Lightbulb, RotateCcw } from 'lucide-react';
import type { CommunityInsight } from '@/types/brand-strategy';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';

interface CommunityInsightsProps {
  insights: CommunityInsight[];
}

const sentimentIcons = {
  Positive: ThumbsUp,
  Negative: ThumbsDown,
  Neutral: Minus,
};

const sourceVariant: Record<string, any> = {
  Reddit: 'reddit',
  TrustPilot: 'trustpilot',
};

export function CommunityInsights({ insights }: CommunityInsightsProps) {
  const [showJson, setShowJson] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRequesting, setIsRequesting] = useState(false);

  const positiveCount = insights.filter(i => i.sentiment === 'Positive').length;
  const negativeCount = insights.filter(i => i.sentiment === 'Negative').length;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleReRequest = async () => {
    if (selectedIds.size === 0) return;
    try {
      setIsRequesting(true);
      const targets = Array.from(selectedIds).map((id) => ({
        kind: 'brand_mention' as const,
        id,
      }));
      await apiClient.reRequestAssets({ targets });
      // Simple UX: clear selection after request
      setSelectedIds(new Set());
    } catch (error) {
      // Errors are surfaced via the http/sonner layer; no-op here
      console.warn('[CommunityInsights] Re-request failed', error);
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <Card variant="glass">
      <CardHeader className="border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
              <MessageSquare className="h-4 w-4 text-accent" />
            </div>
            <div>
              <CardTitle className="text-base">Community Insights</CardTitle>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ThumbsUp className="h-3 w-3 text-success" />
                  {positiveCount} positive
                </span>
                <span className="flex items-center gap-1">
                  <ThumbsDown className="h-3 w-3 text-destructive" />
                  {negativeCount} negative
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              disabled={selectedIds.size === 0 || isRequesting}
              onClick={handleReRequest}
              className="h-7 px-2 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Re-request assets
            </Button>
            <Button 
              variant="terminal" 
              size="sm" 
              onClick={() => setShowJson(!showJson)}
              className="h-7 px-2"
            >
              <Code className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {showJson ? (
          <pre className="p-4 rounded-lg bg-background/50 text-xs overflow-auto max-h-96 custom-scrollbar text-muted-foreground">
            <code>{JSON.stringify(insights, null, 2)}</code>
          </pre>
        ) : (
          <div className="space-y-4 max-h-96 overflow-auto custom-scrollbar pr-2">
            {insights.map((insight) => {
              const SentimentIcon = sentimentIcons[insight.sentiment];
              
              return (
                <div
                  key={insight.id}
                  className={cn(
                    "p-4 rounded-lg border flex gap-3",
                    insight.sentiment === 'Positive' && "bg-success/5 border-success/20",
                    insight.sentiment === 'Negative' && "bg-destructive/5 border-destructive/20",
                    insight.sentiment === 'Neutral' && "bg-muted/30 border-border/50"
                  )}
                >
                  <div className="pt-1">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border bg-background"
                      checked={selectedIds.has(insight.id)}
                      onChange={() => toggleSelected(insight.id)}
                    />
                  </div>
                  <div className="flex-1">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={sourceVariant[insight.source] || 'secondary'} className="text-[10px]">
                        {insight.source}
                      </Badge>
                      <Badge 
                        variant={insight.sentiment.toLowerCase() as any}
                        className="text-[10px]"
                      >
                        <SentimentIcon className="h-3 w-3 mr-1" />
                        {insight.sentiment}
                      </Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {new Date(insight.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  
                  <blockquote className="text-sm italic text-foreground/90 border-l-2 border-primary/30 pl-3 mb-3">
                    &quot;{insight.content}&quot;
                  </blockquote>
                  
                  <div className="space-y-2">
                    {insight.painPoints.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Tag className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                        <div className="flex flex-wrap gap-1">
                          {insight.painPoints.map((point, i) => (
                            <Badge key={i} variant="destructive" className="text-[10px] font-normal">
                              {point}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {insight.marketingHooks.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Lightbulb className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
                        <div className="flex flex-wrap gap-1">
                          {insight.marketingHooks.map((hook, i) => (
                            <Badge key={i} variant="warning" className="text-[10px] font-normal">
                              {hook}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
