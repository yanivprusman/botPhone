import { handleFeedbackClose, getAppConfig } from '@addnewfeature/feedback-lib-launcher';
const { appName } = getAppConfig();
export const POST = handleFeedbackClose(appName);
