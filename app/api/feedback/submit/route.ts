import { handleFeedbackSubmit, getAppConfig } from '@addnewfeature/feedback-lib-launcher';
const { appName } = getAppConfig();
export const POST = handleFeedbackSubmit(appName);
