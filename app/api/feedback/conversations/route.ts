import { handleFeedbackConversations, getAppConfig } from '@addnewfeature/feedback-lib-launcher';
const { appName } = getAppConfig();
const { GET, POST } = handleFeedbackConversations(appName);
export { GET, POST };
