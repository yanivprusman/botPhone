"use client";

import { FeedbackChat } from '@claudecontrol/feedback-lib';
import { feedbackBackend } from '@/lib/feedback-backend';

export default function FeedbackChatClient() {
  return <FeedbackChat backend={feedbackBackend} issuesPath="/feedback-lib-issues" />;
}
