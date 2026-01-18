import { useState } from 'react';
import { Layers, Code, Heart, FileText } from 'lucide-react';
import type { ContentPillar } from '@/types/brand-strategy';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ContentPillarsProps {
  pillars: ContentPillar[];
}

const pillarColors = [
  'border-l-primary',
  'border-l-accent',
  'border-l-processing',
];

export function ContentPillars({ pillars }: ContentPillarsProps) {
  const [showJson, setShowJson] = useState(false);
  const [expandedPillar, setExpandedPillar] = useState<string | null>(pillars[0]?.id);

  return (
    <Card variant="glass">
      <CardHeader className="border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
              <Layers className="h-4 w-4 text-warning" />
            </div>
            <div>
              <CardTitle className="text-base">Content Pillars</CardTitle>
              <p className="text-xs text-muted-foreground">
                {pillars.length} strategic content pillars
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
            <code>{JSON.stringify(pillars, null, 2)}</code>
          </pre>
        ) : (
          <div className="space-y-3">
            {pillars.map((pillar, index) => (
              <div
                key={pillar.id}
                className={`rounded-lg border border-border/50 bg-card/50 overflow-hidden transition-all cursor-pointer hover:border-primary/30 ${pillarColors[index % pillarColors.length]} border-l-4`}
                onClick={() => setExpandedPillar(expandedPillar === pillar.id ? null : pillar.id)}
              >
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm">{pillar.name}</h4>
                    <Badge variant="secondary" className="text-[10px]">
                      {pillar.contentTypes.length} types
                    </Badge>
                  </div>
                  
                  {expandedPillar === pillar.id && (
                    <div className="mt-4 space-y-4 animate-slide-in">
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                          <FileText className="h-3 w-3" />
                          Rationale
                        </div>
                        <p className="text-sm text-foreground/80 leading-relaxed">
                          {pillar.rationale}
                        </p>
                      </div>
                      
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                          <Heart className="h-3 w-3" />
                          Emotional Connection
                        </div>
                        <p className="text-sm text-foreground/80 italic">
                          "{pillar.emotionalConnection}"
                        </p>
                      </div>
                      
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          Content Types
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {pillar.contentTypes.map((type, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">
                              {type}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
