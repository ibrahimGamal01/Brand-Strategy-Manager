'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api/http';

export type QuestionOption = { value: string; label: string };
export type Question = {
  key: string;
  text: string;
  type: 'single_select' | 'multi_select' | 'text';
  options?: QuestionOption[];
  optional?: boolean;
};
export type QuestionSet = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  questions: Question[];
};

export function useClientQuestions(researchJobId: string) {
  const [pending, setPending] = useState<QuestionSet[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!researchJobId) return;
    try {
      const data = await apiFetch<{ pending: QuestionSet[] }>(`/research-jobs/${researchJobId}/questions/pending`);
      setPending(data.pending || []);
      if (data.pending?.length) setActiveId(data.pending[0].id);
    } catch {
      // ignore
    }
  }, [researchJobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeSet = pending.find((p) => p.id === activeId) || null;

  const updateAnswer = (key: string, value: any) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    if (!activeSet) return;
    const payloadAnswers = activeSet.questions
      .map((q) => ({ key: q.key, answer: answers[q.key] }))
      .filter((a) => {
        if (a.answer === undefined || a.answer === null) return false;
        if (typeof a.answer === 'string' && a.answer.trim().length === 0) return false;
        if (Array.isArray(a.answer) && a.answer.length === 0) return false;
        return true;
      });
    if (payloadAnswers.length === 0) return skip();
    setLoading(true);
    try {
      const payload = {
        setId: activeSet.id,
        answers: payloadAnswers,
      };
      await apiFetch(`/research-jobs/${researchJobId}/questions/answer`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const remaining = pending.filter((p) => p.id !== activeSet.id);
      setPending(remaining);
      setActiveId(remaining[0]?.id || null);
      setAnswers({});
    } catch (error: any) {
      console.warn('[ClientQuestions] Failed to submit answers', error);
      // Keep popup open but stop spinner
    } finally {
      setLoading(false);
    }
  };

  const skip = () => {
    const remaining = pending.filter((p) => p.id !== activeSet?.id);
    setPending(remaining);
    setActiveId(remaining[0]?.id || null);
    setAnswers({});
  };

  return { pendingCount: pending.length, activeSet, answers, updateAnswer, submit, skip, loading };
}
