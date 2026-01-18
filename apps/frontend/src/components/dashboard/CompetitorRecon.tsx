import { useState } from 'react';
import { Code, Users, TrendingUp, Check, HelpCircle } from 'lucide-react';
import type { DiscoveredCompetitor } from '@/types/brand-strategy';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface CompetitorReconProps {
  competitors: DiscoveredCompetitor[];
}

const platformIcons: Record<string, string> = {
  instagram: '📸',
  tiktok: '🎵',
  twitter: '🐦',
  linkedin: '💼',
};

function formatFollowers(count?: number): string {
  if (!count) return '-';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(0)}K`;
  return count.toString();
}

export function CompetitorRecon({ competitors }: CompetitorReconProps) {
  const [showJson, setShowJson] = useState(false);

  const confirmed = competitors.filter(c => c.status === 'CONFIRMED');
  const suggested = competitors.filter(c => c.status === 'SUGGESTED');

  return (
    <Card variant="glass">
      <CardHeader className="border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Social Reconnaissance</CardTitle>
              <p className="text-xs text-muted-foreground">
                {confirmed.length} confirmed · {suggested.length} suggested
              </p>
            </div>
          </div>
          <Button 
            variant="terminal" 
            size="sm" 
            onClick={() => setShowJson(!showJson)}
            className="h-7 px-2"
          >
            <Code className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {showJson ? (
          <pre className="p-4 rounded-lg bg-background/50 text-xs overflow-auto max-h-80 custom-scrollbar text-muted-foreground">
            <code>{JSON.stringify(competitors, null, 2)}</code>
          </pre>
        ) : (
          <div className="space-y-3">
            {competitors.map((competitor) => (
              <div
                key={competitor.id}
                className={cn(
                  "p-3 rounded-lg border transition-all hover:border-primary/30",
                  competitor.status === 'CONFIRMED' 
                    ? "bg-success/5 border-success/20" 
                    : "bg-muted/30 border-border/50"
                )}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="text-xl">
                      {platformIcons[competitor.platform]}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium truncate">
                          {competitor.handle}
                        </span>
                        <Badge 
                          variant={competitor.platform as any}
                          className="text-[10px] uppercase"
                        >
                          {competitor.platform}
                        </Badge>
                      </div>
                      {competitor.followerCount && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <TrendingUp className="h-3 w-3" />
                          {formatFollowers(competitor.followerCount)} followers
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-24">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">Relevance</span>
                        <span className="text-xs font-mono text-primary">
                          {Math.round(competitor.relevanceScore * 100)}%
                        </span>
                      </div>
                      <Progress 
                        value={competitor.relevanceScore * 100}
                        variant={competitor.relevanceScore > 0.8 ? 'success' : 'primary'}
                        className="h-1"
                      />
                    </div>
                    <Badge 
                      variant={competitor.status === 'CONFIRMED' ? 'success' : 'pending'}
                      className="text-[10px]"
                    >
                      {competitor.status === 'CONFIRMED' ? (
                        <Check className="h-3 w-3 mr-1" />
                      ) : (
                        <HelpCircle className="h-3 w-3 mr-1" />
                      )}
                      {competitor.status}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
