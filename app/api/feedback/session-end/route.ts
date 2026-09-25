import { handleFeedbackSessionEnd, getAppConfig } from '@addnewfeature/feedback-lib-launcher';
const { appName } = getAppConfig();
export const POST = handleFeedbackSessionEnd(appName);
