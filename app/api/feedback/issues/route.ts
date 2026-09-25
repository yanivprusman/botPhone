import { handleFeedbackIssues, getAppConfig } from '@addnewfeature/feedback-lib-launcher';
const { appName } = getAppConfig();
const { GET, POST } = handleFeedbackIssues(appName);
export { GET, POST };
