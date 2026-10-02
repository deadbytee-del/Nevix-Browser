'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nx', {
  platform: process.platform,
  cmd: (name, arg) => ipcRenderer.invoke('nx:cmd', name, arg),
  on: (channel, fn) => ipcRenderer.on('nx:' + channel, (_e, data) => fn(data)),
});
