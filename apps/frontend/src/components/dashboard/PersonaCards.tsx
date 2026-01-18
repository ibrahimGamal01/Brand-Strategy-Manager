import { useState } from 'react';
import { User, Code, Target, Frown, Award } from 'lucide-react';
import type { Persona } from '@/types/brand-strategy';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface PersonaCardsProps {
  personas: Persona[];
}

const avatarColors = [
  'from-cyan-500 to-blue-500',
  'from-purple-500 to-pink-500',
  'from-amber-500 to-orange-500',
];

export function PersonaCards({ personas }: PersonaCardsProps) {
  const [showJson, setShowJson] = useState(false);

  return (
    <Card variant="glass">
      <CardHeader className="border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-processing/10">
              <User className="h-4 w-4 text-processing" />
            </div>
            <div>
              <CardTitle className="text-base">Target Personas</CardTitle>
              <p className="text-xs text-muted-foreground">
                {personas.length} strategic personas defined
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
            <code>{JSON.stringify(personas, null, 2)}</code>
          </pre>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {personas.map((persona, index) => (
              <div
                key={persona.id}
                className="p-4 rounded-lg border border-border/50 bg-card/50 hover:border-primary/30 transition-all"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${avatarColors[index % avatarColors.length]} text-white font-bold text-lg`}>
                    {persona.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">{persona.name}</h4>
                    <p className="text-xs text-muted-foreground">{persona.role}</p>
                    <Badge variant="secondary" className="text-[10px] mt-1">
                      {persona.age}
                    </Badge>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-destructive mb-1.5">
                      <Frown className="h-3 w-3" />
                      Pain Points
                    </div>
                    <ul className="space-y-1">
                      {persona.painPoints.map((point, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <span className="text-destructive/70">•</span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                  
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-success mb-1.5">
                      <Target className="h-3 w-3" />
                      Goals
                    </div>
                    <ul className="space-y-1">
                      {persona.goals.map((goal, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <span className="text-success/70">•</span>
                          {goal}
                        </li>
                      ))}
                    </ul>
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
