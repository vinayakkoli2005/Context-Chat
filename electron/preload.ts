import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc-channels';

// Only allow IPC over channels the app actually defines. This keeps the generic
// bridge convenient while removing the "any channel" attack surface — a
// compromised renderer can no longer reach arbitrary or future main-process
// handlers, only the known set in IPC.
const ALLOWED_CHANNELS = new Set<string>(Object.values(IPC));
const assertAllowed = (channel: string): void => {
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw new Error(`Blocked IPC on disallowed channel: ${channel}`);
  }
};

contextBridge.exposeInMainWorld('cc', {
  // generic invokers, restricted to known channels
  invoke: (channel: string, ...args: any[]) => {
    assertAllowed(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  send: (channel: string, ...args: any[]) => {
    assertAllowed(channel);
    ipcRenderer.send(channel, ...args);
  },
  on: (channel: string, listener: (...args: any[]) => void) => {
    assertAllowed(channel);
    const wrapped = (_e: unknown, ...args: any[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  channels: IPC
});

declare global {
  interface Window {
    cc: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      send: (channel: string, ...args: any[]) => void;
      on: (channel: string, listener: (...args: any[]) => void) => () => void;
      channels: typeof IPC;
    };
  }
}
