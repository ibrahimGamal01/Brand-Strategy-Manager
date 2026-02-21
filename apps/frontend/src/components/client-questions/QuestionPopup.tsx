'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useClientQuestions } from './useClientQuestions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function QuestionPopup({ researchJobId }: { researchJobId: string }) {
  const { activeSet, answers, updateAnswer, submit, skip, loading, pendingCount } = useClientQuestions(researchJobId);
  const visible = Boolean(activeSet);
  const q = activeSet?.questions || [];

  const rendered = useMemo(
    () =>
      q.map((question) => {
        if (question.type === 'text') {
          return (
            <div key={question.key} className="space-y-1">
              <Label className="text-sm font-semibold">{question.text}</Label>
              <Textarea
                className="resize-none"
                rows={3}
                value={answers[question.key] || ''}
                onChange={(e) => updateAnswer(question.key, e.target.value)}
              />
            </div>
          );
        }
        if (question.type === 'single_select') {
          return (
            <div key={question.key} className="space-y-2">
              <Label className="text-sm font-semibold">{question.text}</Label>
              <RadioGroup
                value={answers[question.key] || ''}
                onValueChange={(v) => updateAnswer(question.key, v)}
                className="space-y-2"
              >
                {(question.options || []).map((opt) => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <RadioGroupItem value={opt.value} id={`${question.key}-${opt.value}`} />
                    <Label htmlFor={`${question.key}-${opt.value}`} className="text-sm">
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          );
        }
        if (question.type === 'multi_select') {
          const selected: string[] = answers[question.key] || [];
          return (
            <div key={question.key} className="space-y-2">
              <Label className="text-sm font-semibold">{question.text}</Label>
              <div className="space-y-2">
                {(question.options || []).map((opt) => {
                  const checked = selected.includes(opt.value);
                  return (
                    <div key={opt.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`${question.key}-${opt.value}`}
                        checked={checked}
                        onCheckedChange={(v) => {
                          const next = v
                            ? [...selected, opt.value]
                            : selected.filter((s) => s !== opt.value);
                          updateAnswer(question.key, next);
                        }}
                      />
                      <Label htmlFor={`${question.key}-${opt.value}`} className="text-sm">
                        {opt.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }
        return null;
      }),
    [q, answers, updateAnswer]
  );

  return (
    <div
      className={`fixed bottom-4 right-4 z-40 w-96 max-w-[92vw] transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0 pointer-events-none'
      }`}
    >
      <div className="rounded-2xl border border-border/60 bg-card/90 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Client questions</p>
            <h4 className="text-sm font-semibold leading-tight">{activeSet?.title || 'No questions right now'}</h4>
          </div>
          <div className="flex items-center gap-2">
            {pendingCount > 1 ? <Badge variant="outline">{pendingCount} pending</Badge> : null}
            <button
              className="rounded-full p-1 hover:bg-muted"
              aria-label="Close"
              onClick={skip}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {activeSet ? (
          <div className="space-y-3 px-4 py-3 text-sm">
            {activeSet.description ? (
              <p className="text-muted-foreground text-xs">{activeSet.description}</p>
            ) : null}
            <div className="space-y-4">{rendered}</div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={skip} disabled={loading}>
                Skip for now
              </Button>
              <Button size="sm" onClick={submit} disabled={loading}>
                {loading ? 'Saving…' : 'Submit answers'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-4 text-sm text-muted-foreground">No questions pending.</div>
        )}
      </div>
    </div>
  );
}
