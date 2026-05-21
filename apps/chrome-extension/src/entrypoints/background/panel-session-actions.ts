import type { PanelSession } from "./panel-session-store";

export function handlePanelReady<Recovery, Status>(
  session: PanelSession<Recovery, Status> & {
    daemonRecovery: { clearPending: () => void };
  },
  options: {
    emitState: () => void;
    summarizeActiveTab: (reason: string) => void;
  },
) {
  session.panelOpen = true;
  session.panelLastPingAt = Date.now();
  session.lastSummarizedUrl = null;
  session.inflightUrl = null;
  session.inflightRequest = null;
  session.activeSummaryRun = null;
  session.runController?.abort();
  session.runController = null;
  session.agentController?.abort();
  session.agentController = null;
  session.daemonRecovery.clearPending();
  options.emitState();
  options.summarizeActiveTab("panel-open");
}

export function handlePanelClosed<Recovery, Status>(
  session: PanelSession<Recovery, Status> & {
    daemonRecovery: { clearPending: () => void };
  },
  options: {
    clearCachedExtractsForWindow: (windowId: number) => Promise<void>;
  },
) {
  session.panelOpen = false;
  session.panelLastPingAt = 0;
  session.runController?.abort();
  session.runController = null;
  session.agentController?.abort();
  session.agentController = null;
  session.lastSummarizedUrl = null;
  session.inflightUrl = null;
  session.inflightRequest = null;
  session.activeSummaryRun = null;
  session.daemonRecovery.clearPending();
  void options.clearCachedExtractsForWindow(session.windowId);
}

export async function handlePanelSetAuto(options: {
  value: boolean;
  patchSettings: typeof import("../../lib/settings").patchSettings;
  emitState: () => void;
  summarizeActiveTab: (reason: string) => void;
}) {
  await options.patchSettings({ autoSummarize: options.value });
  options.emitState();
  if (options.value) options.summarizeActiveTab("auto-enabled");
}

export async function handlePanelSetLength(options: {
  value: string;
  loadSettings: typeof import("../../lib/settings").loadSettings;
  patchSettings: typeof import("../../lib/settings").patchSettings;
  emitState: () => void;
  summarizeActiveTab: (reason: string) => void;
}) {
  const current = await options.loadSettings();
  if (current.length === options.value) return;
  await options.patchSettings({ length: options.value });
  options.emitState();
  options.summarizeActiveTab("length-change");
}
