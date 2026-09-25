"use client";

import { FeedbackIssuesPage } from "@claudecontrol/feedback-lib";
import type { MaintenancePrompt } from "@claudecontrol/feedback-lib";
import { feedbackBackend } from "@/lib/feedback-backend";

export default function FeedbackIssuesPageMount({
  initialAppName,
  maintenancePrompts,
}: {
  initialAppName: string | null;
  maintenancePrompts: MaintenancePrompt[];
}) {
  return (
    <FeedbackIssuesPage
      backend={feedbackBackend}
      maintenancePrompts={maintenancePrompts}
      initialAppName={initialAppName}
      colorScheme="dark"
    />
  );
}
