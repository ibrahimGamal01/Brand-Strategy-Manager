"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  answerWorkspaceProcessQuestion,
  fetchWorkspaceActiveProcessQuestion,
  type ProcessQuestionTaskDto,
} from "@/lib/runtime-api";

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function titleCase(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return "";
  return normalized.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

type ModalAnswerState = {
  textAnswer: string;
  selectedOption: string;
  selectedOptions: string[];
};

const DEFAULT_STATE: ModalAnswerState = {
  textAnswer: "",
  selectedOption: "",
  selectedOptions: [],
};

const POLL_MS = 12_000;

export function WorkspaceProcessQuestionModalHost({ workspaceId }: { workspaceId: string }) {
  const [question, setQuestion] = useState<ProcessQuestionTaskDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ModalAnswerState>(DEFAULT_STATE);

  const loadActiveQuestion = useCallback(async () => {
    try {
      const payload = await fetchWorkspaceActiveProcessQuestion(workspaceId);
      setQuestion(payload.question || null);
      setError(null);
    } catch (loadError) {
      setError(String((loadError as Error)?.message || "Failed to load active question"));
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadActiveQuestion();
  }, [loadActiveQuestion]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadActiveQuestion();
    }, POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadActiveQuestion();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadActiveQuestion]);

  useEffect(() => {
    setState(DEFAULT_STATE);
  }, [question?.id]);

  const answerType = question?.answerType || "text";
  const options = useMemo(() => (Array.isArray(question?.options) ? question?.options : []), [question?.options]);
  const suggestedAnswers = useMemo(
    () => (Array.isArray(question?.suggestedAnswers) ? question?.suggestedAnswers.filter((entry) => normalizeText(entry)) : []),
    [question?.suggestedAnswers]
  );

  const isVisible =
    Boolean(question) &&
    (question?.severity === "BLOCKER" || question?.severity === "IMPORTANT") &&
    question?.status === "OPEN";

  const submitAnswer = useCallback(async () => {
    if (!question) return;
    setSubmitting(true);
    setError(null);
    try {
      if (answerType === "single_select") {
        const selectedOption = normalizeText(state.selectedOption);
        if (!selectedOption) {
          throw new Error("Please select one option to continue.");
        }
        await answerWorkspaceProcessQuestion(workspaceId, question.id, { selectedOption });
      } else if (answerType === "multi_select") {
        const selectedOptions = Array.from(new Set(state.selectedOptions.map((entry) => normalizeText(entry)).filter(Boolean)));
        if (selectedOptions.length === 0) {
          throw new Error("Please select at least one option to continue.");
        }
        await answerWorkspaceProcessQuestion(workspaceId, question.id, { selectedOptions });
      } else {
        const answerText = normalizeText(state.textAnswer);
        if (!answerText) {
          throw new Error("Please provide an answer to continue.");
        }
        await answerWorkspaceProcessQuestion(workspaceId, question.id, { answerText });
      }
      await loadActiveQuestion();
    } catch (submitError) {
      setError(String((submitError as Error)?.message || "Failed to submit answer"));
    } finally {
      setSubmitting(false);
    }
  }, [answerType, loadActiveQuestion, question, state.selectedOption, state.selectedOptions, state.textAnswer, workspaceId]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <section className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Runtime Question
          </p>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              question?.severity === "BLOCKER"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {titleCase(question?.severity)}
          </span>
        </div>

        <h3 className="mt-2 text-base font-semibold text-zinc-900">
          {question?.question}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          Field: {question?.fieldKey} {question?.sourceSectionKey ? `• Section: ${titleCase(question.sourceSectionKey)}` : ""}
        </p>

        <div className="mt-4 space-y-3">
          {answerType === "single_select" ? (
            <div className="space-y-2">
              {options.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800">
                  <input
                    type="radio"
                    name={`question-${question?.id}`}
                    value={option.value}
                    checked={state.selectedOption === option.value}
                    onChange={() => setState((previous) => ({ ...previous, selectedOption: option.value }))}
                    className="h-4 w-4"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          ) : null}

          {answerType === "multi_select" ? (
            <div className="space-y-2">
              {options.map((option) => {
                const checked = state.selectedOptions.includes(option.value);
                return (
                  <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      value={option.value}
                      checked={checked}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setState((previous) => {
                          if (enabled) {
                            return {
                              ...previous,
                              selectedOptions: Array.from(new Set([...previous.selectedOptions, option.value])),
                            };
                          }
                          return {
                            ...previous,
                            selectedOptions: previous.selectedOptions.filter((entry) => entry !== option.value),
                          };
                        });
                      }}
                      className="h-4 w-4"
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          ) : null}

          {answerType === "text" ? (
            <div className="space-y-2">
              {suggestedAnswers.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {suggestedAnswers.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setState((previous) => ({ ...previous, textAnswer: suggestion }))}
                      className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                rows={4}
                value={state.textAnswer}
                onChange={(event) => setState((previous) => ({ ...previous, textAnswer: event.target.value }))}
                className="w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none"
                placeholder="Write your answer..."
              />
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 text-xs text-rose-700">{error}</p>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void submitAnswer()}
            disabled={submitting}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit answer"}
          </button>
        </div>
      </section>
    </div>
  );
}
