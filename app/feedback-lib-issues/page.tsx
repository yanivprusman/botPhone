import { MAINTENANCE_PROMPTS } from "@addnewfeature/feedback-lib-launcher";
import FeedbackIssuesPageMount from "./FeedbackIssuesPageMount";

export { generateFeedbackIssuesMetadata as generateMetadata } from "@claudecontrol/feedback-lib";

export default async function FeedbackIssues({
  searchParams,
}: {
  searchParams: Promise<{ app?: string }>;
}) {
  const { app } = await searchParams;
  return (
    <FeedbackIssuesPageMount
      initialAppName={app ?? null}
      maintenancePrompts={MAINTENANCE_PROMPTS}
    />
  );
}
