"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SignupSectionId = "identity" | "company" | "web" | "social" | "review";

export type SignupValidationState = Record<
  SignupSectionId,
  {
    complete: boolean;
    errorCount: number;
  }
>;

type UseSignupScrollOptions = {
  sectionIds: SignupSectionId[];
  sectionTopOffset?: number;
  storageKey?: string;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

export function useSignupScroll({
  sectionIds,
  sectionTopOffset = 116,
  storageKey = "bat.signup.scrollY",
}: UseSignupScrollOptions) {
  const [activeSection, setActiveSection] = useState<SignupSectionId>(sectionIds[0]);
  const refs = useRef<Partial<Record<SignupSectionId, HTMLElement | null>>>({});

  const registerSection = useCallback(
    (id: SignupSectionId) => (element: HTMLElement | null) => {
      refs.current[id] = element;
    },
    []
  );

  const scrollToSection = useCallback((id: SignupSectionId) => {
    const element = refs.current[id];
    if (!element) return;
    element.scrollIntoView({ behavior: getBehavior(), block: "start" });
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return;

    const scrollY = Number(saved);
    if (!Number.isFinite(scrollY) || scrollY < 0) return;

    const id = requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "auto" });
    });

    return () => {
      cancelAnimationFrame(id);
    };
  }, [storageKey]);

  useEffect(() => {
    let ticking = false;

    const persist = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        sessionStorage.setItem(storageKey, String(window.scrollY));
        ticking = false;
      });
    };

    window.addEventListener("scroll", persist, { passive: true });
    return () => {
      window.removeEventListener("scroll", persist);
    };
  }, [storageKey]);

  useEffect(() => {
    const sectionElements = sectionIds
      .map((id) => refs.current[id])
      .filter(Boolean) as HTMLElement[];

    if (!sectionElements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visible) return;

        const match = sectionIds.find((id) => refs.current[id] === visible.target);
        if (match) {
          setActiveSection(match);
        }
      },
      {
        root: null,
        rootMargin: `-${sectionTopOffset}px 0px -50% 0px`,
        threshold: [0.2, 0.4, 0.65],
      }
    );

    sectionElements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
    };
  }, [sectionIds, sectionTopOffset]);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (window.innerWidth > 900) return;

      const rect = target.getBoundingClientRect();
      const needsScroll = rect.bottom > window.innerHeight - 120 || rect.top < sectionTopOffset + 20;
      if (!needsScroll) return;

      window.setTimeout(() => {
        target.scrollIntoView({ behavior: getBehavior(), block: "center" });
      }, 80);
    };

    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [sectionTopOffset]);

  return {
    activeSection,
    registerSection,
    scrollToSection,
  };
}
