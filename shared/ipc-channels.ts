export const IPC_CHANNELS = {
  API_KEY: {
    GET_ALL: 'api-key:get-all',
    SAVE: 'api-key:save',
    DELETE: 'api-key:delete',
    VALIDATE: 'api-key:validate'
  },
  CHAT: {
    SEND: 'chat:send',
    STREAM: 'chat:stream',
    CANCEL: 'chat:cancel',
    ANALYZE_INTENT: 'chat:analyze-intent'
  },
  IMAGE: {
    GENERATE: 'image:generate'
  },
  SETTINGS: {
    GET: 'settings:get',
    UPDATE: 'settings:update'
  },
  APP: {
    PLATFORM: 'app:platform',
    VERSION: 'app:version'
  }
} as const
