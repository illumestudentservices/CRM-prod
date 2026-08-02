"use client";

import * as React from "react";

/**
 * Installs the offline service worker, and only from the capture page.
 *
 * Registered here rather than in the root layout on purpose. A worker
 * registered app-wide would install itself on every user who ever opens the
 * CRM, including the majority who never attend an event — and a service worker
 * is the one thing that can keep breaking pages after the deploy that caused it
 * has been rolled back, because it lives on the device. Limiting installation to
 * the people who need it keeps that blast radius as small as the feature.
 *
 * An ICR reaches this page to tap "Prepare for offline" before travelling
 * anyway, so the worker is installed by the same action that makes the page
 * usable offline in the first place.
 */
export function RegisterOfflineWorker() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Registration is deferred until the page has settled. Competing with the
    // page's own requests during load is what makes service workers feel like
    // they slow a site down.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Not fatal: without the worker the page still captures leads once
          // loaded, it just cannot cold-start with no signal. Worth a console
          // line, not worth an error in the user's face.
          console.warn("[offline] service worker registration failed", err);
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
