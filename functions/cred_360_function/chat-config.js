'use strict';

// Team chat configuration (Development values — fill these in after creating the
// resources in the Catalyst console, see CHAT_SETUP.md).
module.exports = {
  // File Store folder ID that holds chat attachments. Required for file uploads.
  CHAT_FOLDER_ID: '',

  // Data Streams channel ID or name used for "new message" pings. Optional:
  // when empty (or the Data Streams SDK is unavailable) chat uses adaptive polling.
  CHAT_CHANNEL: '',
};
