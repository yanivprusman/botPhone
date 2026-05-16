"use client";

import { FeedbackChat } from '@automate/feedback-lib/FeedbackChat';
import { feedbackBackend } from '@/lib/feedback-backend';

export default function FeedbackChatClient() {
  return <FeedbackChat backend={feedbackBackend} issuesPath="/feedback-lib-issues" />;
}
