import { handleFeedbackSessionHistory, getAppConfig } from '@addnewfeature/feedback-lib-launcher';
const { appName } = getAppConfig();
export const GET = handleFeedbackSessionHistory(appName);
