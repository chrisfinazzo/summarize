export type PanelSession<Recovery, Status> = {
  windowId: number;
  port: chrome.runtime.Port;
  panelOpen: boolean;
  panelLastPingAt: number;
  lastSummarizedUrl: string | null;
  inflightUrl: string | null;
  inflightRequest: {
    url: string;
    inputMode: "page" | "video" | null;
    slides: boolean;
  } | null;
  activeSummaryRun: {
    run: {
      id: string;
      url: string;
      title: string | null;
      model: string;
      reason: string;
      slides?: boolean;
    };
    startedAt: number;
    inputMode: "page" | "video" | null;
    slides: boolean;
  } | null;
  runController: AbortController | null;
  agentController: AbortController | null;
  lastNavAt: number;
  daemonRecovery: Recovery;
  daemonStatus: Status;
};

export function createPanelSessionStore<
  CachedExtract extends { url: string },
  PanelCachePayload extends { tabId: number; url: string },
  Recovery,
  Status,
>({
  createDaemonRecovery,
  createDaemonStatus,
}: {
  createDaemonRecovery: () => Recovery;
  createDaemonStatus: () => Status;
}) {
  const panelSessions = new Map<number, PanelSession<Recovery, Status>>();
  const lastMediaProbeByTab = new Map<number, string>();
  const cachedExtracts = new Map<number, CachedExtract>();
  const panelCacheByTabId = new Map<number, PanelCachePayload>();

  const getPanelPortMap = () => {
    const global = globalThis as typeof globalThis & {
      __summarizePanelPorts?: Map<number, chrome.runtime.Port>;
    };
    if (!global.__summarizePanelPorts) {
      global.__summarizePanelPorts = new Map();
    }
    return global.__summarizePanelPorts;
  };

  return {
    isPanelOpen(session: PanelSession<Recovery, Status>) {
      if (!session.panelOpen) return false;
      if (session.panelLastPingAt === 0) return true;
      return Date.now() - session.panelLastPingAt < 45_000;
    },
    getPanelSession(windowId: number) {
      return panelSessions.get(windowId) ?? null;
    },
    getPanelSessions() {
      return panelSessions.values();
    },
    registerPanelSession(windowId: number, port: chrome.runtime.Port) {
      const existing = panelSessions.get(windowId);
      if (existing && existing.port !== port) {
        existing.runController?.abort();
        existing.agentController?.abort();
      }
      const session: PanelSession<Recovery, Status> = existing ?? {
        windowId,
        port,
        panelOpen: false,
        panelLastPingAt: 0,
        lastSummarizedUrl: null,
        inflightUrl: null,
        inflightRequest: null,
        activeSummaryRun: null,
        runController: null,
        agentController: null,
        lastNavAt: 0,
        daemonRecovery: createDaemonRecovery(),
        daemonStatus: createDaemonStatus(),
      };
      session.port = port;
      panelSessions.set(windowId, session);
      getPanelPortMap().set(windowId, port);
      return session;
    },
    deletePanelSession(windowId: number) {
      panelSessions.delete(windowId);
      getPanelPortMap().delete(windowId);
    },
    getCachedExtract(tabId: number, url?: string | null) {
      const cached = cachedExtracts.get(tabId) ?? null;
      if (!cached) return null;
      if (url && cached.url !== url) {
        cachedExtracts.delete(tabId);
        return null;
      }
      return cached;
    },
    setCachedExtract(tabId: number, payload: CachedExtract) {
      cachedExtracts.set(tabId, payload);
    },
    rememberMediaProbe(tabId: number, url: string) {
      lastMediaProbeByTab.set(tabId, url);
    },
    getLastMediaProbe(tabId: number) {
      return lastMediaProbeByTab.get(tabId) ?? null;
    },
    storePanelCache(payload: PanelCachePayload) {
      panelCacheByTabId.set(payload.tabId, payload);
    },
    getPanelCache(tabId: number, url?: string | null) {
      const cached = panelCacheByTabId.get(tabId) ?? null;
      if (!cached) return null;
      if (url && cached.url !== url) return null;
      return cached;
    },
    async clearCachedExtractsForWindow(windowId: number) {
      try {
        const tabs = await chrome.tabs.query({ windowId });
        for (const tab of tabs) {
          if (!tab.id) continue;
          cachedExtracts.delete(tab.id);
          lastMediaProbeByTab.delete(tab.id);
        }
      } catch {
        // ignore
      }
    },
    clearTab(tabId: number) {
      cachedExtracts.delete(tabId);
      lastMediaProbeByTab.delete(tabId);
      panelCacheByTabId.delete(tabId);
    },
  };
}
