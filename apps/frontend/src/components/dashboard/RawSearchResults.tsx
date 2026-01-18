import { useState } from 'react';
import { ExternalLink, ChevronDown, ChevronUp, Code } from 'lucide-react';
import type { RawSearchResult } from '@/types/brand-strategy';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface RawSearchResultsProps {
  results: RawSearchResult[];
}

export function RawSearchResults({ results }: RawSearchResultsProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showJson, setShowJson] = useState(false);

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <Card variant="terminal" className="overflow-hidden">
      <CardHeader className="border-b border-border/50 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full bg-destructive/60" />
              <div className="h-3 w-3 rounded-full bg-warning/60" />
              <div className="h-3 w-3 rounded-full bg-success/60" />
            </div>
            <CardTitle className="font-mono text-sm">
              raw_search_results.json
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {results.length} entries
            </span>
            <Button 
              variant="terminal" 
              size="sm" 
              onClick={() => setShowJson(!showJson)}
              className="h-7 px-2"
            >
              <Code className="h-3.5 w-3.5" />
              <span className="text-xs">{showJson ? 'Cards' : 'JSON'}</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {showJson ? (
          <pre className="p-4 text-xs overflow-auto max-h-96 custom-scrollbar text-muted-foreground">
            <code>{JSON.stringify(results, null, 2)}</code>
          </pre>
        ) : (
          <div className="divide-y divide-border/50 max-h-96 overflow-auto custom-scrollbar">
            {results.map((result) => (
              <div 
                key={result.id}
                className="p-4 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={result.source === 'google' ? 'google' : 'duckduckgo'} 
                        className="text-[10px] uppercase tracking-wide"
                      >
                        {result.source}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        query: "{result.query}"
                      </span>
                    </div>
                    <a
                      href={result.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block font-medium text-sm text-foreground hover:text-primary transition-colors line-clamp-1"
                    >
                      {result.title}
                    </a>
                    <p 
                      className={`text-xs text-muted-foreground font-mono leading-relaxed ${
                        expanded[result.id] ? '' : 'line-clamp-2'
                      }`}
                    >
                      {result.body}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => toggleExpand(result.id)}
                    >
                      {expanded[result.id] ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                    <a
                      href={result.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </a>
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
