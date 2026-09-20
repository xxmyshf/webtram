export interface TerminalConfig {
  asrApiUrl: string;
  wsUrl?: string;
  defaultPassword?: string;
  scope?: string;
  conversationId?: string;
}

declare global {
  interface Window {
    TERMINAL_CONFIG?: Partial<TerminalConfig>;
  }
}

export function getTerminalConfig(): TerminalConfig {
  const custom = window.TERMINAL_CONFIG || {};
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultWsUrl = `${protocol}//${window.location.host}/ws`;

  return {
    asrApiUrl: custom.asrApiUrl || '/api/asr',
    wsUrl: custom.wsUrl || defaultWsUrl,
    defaultPassword: custom.defaultPassword || '',
    scope: custom.scope || custom.conversationId,
    conversationId: custom.conversationId || custom.scope
  };
}
