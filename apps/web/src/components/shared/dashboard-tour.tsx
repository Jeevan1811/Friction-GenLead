"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Driver } from "driver.js";

type DashboardTourStep = {
  path: string;
  target: string;
  title: string;
  description: string;
  side: "top" | "right" | "bottom" | "left";
};

export const DASHBOARD_TOUR_STEPS: readonly DashboardTourStep[] = [
  {
    path: "/",
    target: '[data-tour="dashboard-overview"]',
    title: "Your prospect pipeline",
    description:
      "These totals come from the records loaded into GenLead. Quick Actions take you to the main review and search tasks.",
    side: "bottom",
  },
  {
    path: "/search",
    target: '[data-tour="search-overview"]',
    title: "Search anywhere by place",
    description:
      "Search by place and sector. Coverage varies; review each candidate before contacting it.",
    side: "bottom",
  },
  {
    path: "/companies",
    target: '[data-tour="companies-overview"]',
    title: "Review companies",
    description:
      "This is the main company list imported from MSV’s workbook. Open a row to review its details; Approve and Reject are human decisions saved to the Sheet.",
    side: "bottom",
  },
  {
    path: "/locations",
    target: '[data-tour="locations-overview"]',
    title: "Check business sites",
    description:
      "Locations are the company’s sites—such as an office, depot, mine or plant. The map uses exact saved coordinates when available; legacy Australian postcode-only records are shown at an approximate postcode centre.",
    side: "bottom",
  },
  {
    path: "/contacts",
    target: '[data-tour="contacts-overview"]',
    title: "Find the right person",
    description:
      "Contacts from the workbook remain available. If a company has a website URL, public pages can be checked for explicitly named people and roles; every match stays unverified until reviewed.",
    side: "bottom",
  },
  {
    path: "/source-data",
    target: '[data-tour="source-data-overview"]',
    title: "Search the original workbook rows",
    description:
      "Use Original source data to find every imported Excel field, including unnamed landlines, verification/source notes, raw postcodes, and the original SMC text. Open a row to see all its original columns. Unmatched rows stay visible instead of being turned into guessed companies.",
    side: "bottom",
  },
  {
    path: "/follow-ups",
    target: '[data-tour="follow-ups-overview"]',
    title: "Keep the next step visible",
    description:
      "Call notes are saved with the company. Follow-ups due soon or overdue appear here; mark them done when finished, or reopen them if plans change.",
    side: "bottom",
  },
  {
    path: "/searches",
    target: '[data-tour="searches-overview"]',
    title: "Search history",
    description:
      "Click a company count to open that run’s saved results. Older runs may keep summary counts only.",
    side: "bottom",
  },
  {
    path: "/rejected",
    target: '[data-tour="rejected-overview"]',
    title: "Keep rejected records separate",
    description:
      "Records you reject appear here rather than in the active pipeline. There is no undo action yet, so check the record before rejecting it.",
    side: "bottom",
  },
  {
    path: "/settings",
    target: '[data-tour="settings-guide"]',
    title: "Replay this guide any time",
    description:
      "Come back to Settings whenever you want the walkthrough again. The guide only points out screens—it never submits forms or changes your data.",
    side: "top",
  },
];

const STORAGE_KEY = "genlead.dashboard-tour.step";

type DashboardTourContextValue = {
  startDashboardTour: () => void;
};

const DashboardTourContext = createContext<DashboardTourContextValue | null>(
  null
);

export function useDashboardTour() {
  const value = useContext(DashboardTourContext);
  if (!value) {
    throw new Error("useDashboardTour must be used inside DashboardTourProvider");
  }
  return value;
}

export function DashboardTourProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const driverRef = useRef<Driver | null>(null);
  const changingStepRef = useRef(false);

  const finishTour = useCallback(() => {
    window.sessionStorage.removeItem(STORAGE_KEY);
    changingStepRef.current = false;
    setStepIndex(null);
  }, []);

  const moveToStep = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= DASHBOARD_TOUR_STEPS.length) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      changingStepRef.current = true;
      setStepIndex(null);
      return;
    }

    window.sessionStorage.setItem(STORAGE_KEY, String(nextIndex));
    changingStepRef.current = true;
    setStepIndex(nextIndex);
  }, []);

  const startDashboardTour = useCallback(() => {
    window.sessionStorage.setItem(STORAGE_KEY, "0");
    changingStepRef.current = true;
    setStepIndex(0);
  }, []);

  useEffect(() => {
    const savedValue = window.sessionStorage.getItem(STORAGE_KEY);
    if (savedValue === null) return;
    const savedStep = Number(savedValue);
    if (
      Number.isInteger(savedStep) &&
      savedStep >= 0 &&
      savedStep < DASHBOARD_TOUR_STEPS.length
    ) {
      setStepIndex(savedStep);
    }
  }, []);

  useEffect(() => {
    if (stepIndex === null) return;

    const step = DASHBOARD_TOUR_STEPS[stepIndex];
    if (pathname !== step.path) {
      router.push(step.path);
      return;
    }

    changingStepRef.current = false;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const showStep = async () => {
      const target = document.querySelector(step.target);
      if (!target) {
        retryTimer = setTimeout(() => {
          if (!cancelled) void showStep();
        }, 150);
        return;
      }

      try {
        const { driver } = await import("driver.js");
        if (cancelled) return;

        const tourDriver = driver({
          animate: true,
          duration: 220,
          overlayColor: "#1A1714",
          overlayOpacity: 0.58,
          stagePadding: 8,
          stageRadius: 8,
          smoothScroll: true,
          allowScroll: true,
          allowClose: true,
          allowKeyboardControl: true,
          showProgress: true,
          progressText: `${stepIndex + 1} of ${DASHBOARD_TOUR_STEPS.length}`,
          showButtons: ["previous", "next", "close"],
          disableButtons: stepIndex === 0 ? ["previous"] : [],
          prevBtnText: "Back",
          nextBtnText:
            stepIndex === DASHBOARD_TOUR_STEPS.length - 1
              ? "Finish"
              : "Next",
          popoverClass: "genlead-tour-popover",
          onNextClick: () => {
            moveToStep(stepIndex + 1);
          },
          onPrevClick: () => {
            moveToStep(stepIndex - 1);
          },
          onCloseClick: (_element, _step, options) => {
            finishTour();
            options.driver.destroy();
          },
          onDestroyStarted: () => {
            if (!changingStepRef.current) finishTour();
          },
          onPopoverRender: (popover, options) => {
            const skipButton = document.createElement("button");
            skipButton.type = "button";
            skipButton.className = "genlead-tour-skip";
            skipButton.textContent = "Skip guide";
            skipButton.setAttribute("aria-label", "Skip dashboard guide");
            skipButton.addEventListener(
              "click",
              () => options.driver.destroy(),
              { once: true }
            );
            popover.footer.prepend(skipButton);
          },
        });

        driverRef.current = tourDriver;
        tourDriver.highlight({
          element: target,
          popover: {
            title: step.title,
            description: step.description,
            side: step.side,
            align: "start",
            showButtons: ["previous", "next", "close"],
            showProgress: true,
            progressText: `${stepIndex + 1} of ${DASHBOARD_TOUR_STEPS.length}`,
            disableButtons: stepIndex === 0 ? ["previous"] : [],
            prevBtnText: "Back",
            nextBtnText:
              stepIndex === DASHBOARD_TOUR_STEPS.length - 1
                ? "Finish"
                : "Next",
            popoverClass: "genlead-tour-popover",
          },
        });
      } catch {
        finishTour();
      }
    };

    void showStep();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      const activeDriver = driverRef.current;
      driverRef.current = null;
      if (activeDriver?.isActive()) activeDriver.destroy();
    };
  }, [finishTour, moveToStep, pathname, router, stepIndex]);

  return (
    <DashboardTourContext.Provider value={{ startDashboardTour }}>
      {children}
    </DashboardTourContext.Provider>
  );
}
