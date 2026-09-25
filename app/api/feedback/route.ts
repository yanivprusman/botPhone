import { handleFeedbackMessage, getAppConfig } from '@addnewfeature/feedback-lib-launcher';
const { appName } = getAppConfig();
export const POST = handleFeedbackMessage(appName);
