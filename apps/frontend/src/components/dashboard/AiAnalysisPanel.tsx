import { useState } from 'react';
import { Brain, Code, Target, Sparkles, Shield, Compass } from 'lucide-react';
import type { AiBusinessAnalysis } from '@/types/brand-strategy';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface AiAnalysisPanelProps {
  analysis?: AiBusinessAnalysis;
}

export function AiAnalysisPanel({ analysis }: AiAnalysisPanelProps) {
  const [showJson, setShowJson] = useState(false);

  if (!analysis) {
    return (
      <Card variant="processing" className="h-full">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-processing/10 animate-pulse">
              <Brain className="h-5 w-5 text-processing" />
            </div>
            <div>
              <CardTitle className="text-lg">AI Business Analysis</CardTitle>
              <p className="text-sm text-muted-foreground">Processing intelligence data...</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-24 bg-muted/50 rounded animate-pulse" />
                <div className="h-20 bg-muted/30 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="glow" className="h-full">
      <CardHeader className="border-b border-primary/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg gradient-text">AI Business Analysis</CardTitle>
              <p className="text-xs text-muted-foreground">Strategic intelligence synthesis</p>
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
      <CardContent className="p-0">
        {showJson ? (
          <pre className="p-4 text-xs overflow-auto max-h-[500px] custom-scrollbar text-muted-foreground">
            <code>{JSON.stringify(analysis, null, 2)}</code>
          </pre>
        ) : (
          <Tabs defaultValue="audience" className="w-full">
            <TabsList className="w-full justify-start rounded-none border-b border-border/50 bg-transparent p-0">
              <TabsTrigger 
                value="audience" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                <Target className="h-3.5 w-3.5 mr-1.5" />
                Audience
              </TabsTrigger>
              <TabsTrigger 
                value="personality" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Personality
              </TabsTrigger>
              <TabsTrigger 
                value="strengths" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                <Shield className="h-3.5 w-3.5 mr-1.5" />
                Strengths
              </TabsTrigger>
              <TabsTrigger 
                value="position" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                <Compass className="h-3.5 w-3.5 mr-1.5" />
                Position
              </TabsTrigger>
            </TabsList>
            
            <div className="p-5 max-h-[400px] overflow-auto custom-scrollbar">
              <TabsContent value="audience" className="mt-0 space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-primary mb-2 flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Target Audience
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {analysis.targetAudience}
                  </p>
                </div>
              </TabsContent>
              
              <TabsContent value="personality" className="mt-0 space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-primary mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Brand Personality
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {analysis.brandPersonality}
                  </p>
                </div>
              </TabsContent>
              
              <TabsContent value="strengths" className="mt-0 space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-primary mb-2 flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Unique Strengths
                  </h4>
                  <ul className="space-y-2">
                    {analysis.uniqueStrengths.map((strength, i) => (
                      <li 
                        key={i}
                        className="flex items-start gap-2 text-sm text-muted-foreground"
                      >
                        <span className="text-primary mt-1">▸</span>
                        {strength}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-primary mb-2">Competitive Advantage</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {analysis.competitiveAdvantage}
                  </p>
                </div>
              </TabsContent>
              
              <TabsContent value="position" className="mt-0 space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-primary mb-2 flex items-center gap-2">
                    <Compass className="h-4 w-4" />
                    Market Positioning
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {analysis.marketPositioning}
                  </p>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
