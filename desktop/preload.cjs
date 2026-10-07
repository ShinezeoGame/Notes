// Pont entre la page d'Ostal et l'application pour ordinateur (main.cjs) : informations, choix du serveur, fichiers
// ouverts avec Ostal, mises à jour, langue de l'interface. Donné seulement aux pages d'Ostal (serveur intégré, serveur choisi, page d'erreur).
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('melo:info');

if (info) {
  let onFiles = null;
  let waitingFiles = [];
  const onUpdates = new Set();

  // Fichiers reçus avant que l'application ne les demande : gardés jusque-là.
  ipcRenderer.on('melo:open-files', (_e, files) => {
    if (onFiles) onFiles(files);
    else waitingFiles.push(...files);
  });
  ipcRenderer.on('melo:update', (_e, update) => {
    info.update = update;
    onUpdates.forEach((cb) => cb(update));
  });

  contextBridge.exposeInMainWorld('meloDesktop', {
    version: info.version,
    api: info.api,
    mode: info.mode,
    localUrl: info.localUrl,
    serverUrl: info.serverUrl,
    embedsAnySite: info.embedsAnySite === true,
    useServer: (url, route) => ipcRenderer.invoke('melo:use-server', String(url), route ? String(route) : ''),
    useLocal: () => ipcRenderer.invoke('melo:use-local'),
    retry: () => ipcRenderer.invoke('melo:retry'),
    onOpenFiles: (callback) => {
      onFiles = callback;
      if (waitingFiles.length) {
        const files = waitingFiles;
        waitingFiles = [];
        callback(files);
      }
      return () => {
        if (onFiles === callback) onFiles = null;
      };
    },
    onUpdate: (callback) => {
      onUpdates.add(callback);
      if (info.update) callback(info.update);
      return () => onUpdates.delete(callback);
    },
    installUpdate: () => ipcRenderer.send('melo:install-update'),
    setLanguage: (lang) => ipcRenderer.send('melo:lang', String(lang)),
  });
}
