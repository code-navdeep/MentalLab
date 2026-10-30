export * from "./db/index.js";
export * from "./config.js";
export * from "./models/index.js";
export * from "./security/crypto.js";
export {
  configureEmbeddings,
  detectEmbeddingsSource,
  embedTexts,
} from "./indexer/embeddings.js";
export {
  addFolder,
  listFolders,
  onIndexProgress,
  removeFolder,
  runIndex,
  startLibrary,
} from "./indexer/library.js";
export { searchLibrary } from "./indexer/search.js";
export {
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  sendChatMessage,
  setConversationPinned,
  setConversationSources,
  setConversationTier,
} from "./chat/index.js";
export * from "./agent/index.js";
export { exportPaperToVault } from "./vault/export.js";
export {
  configureVault,
  deleteVaultNote,
  getBacklinks,
  getVaultGraph,
  getVaultNotes,
  getVaultStatus,
  readVaultNote,
  restartVaultSchedule,
  setVaultFolder,
  setVaultSettings,
  syncVaultNow,
  writeVaultNote,
} from "./vault/index.js";
export { shutdownEngine } from "./shutdown.js";
export {
  addHighlight,
  askPaperCopilot,
  configureReader,
  deletePaper,
  findPaperByPath,
  getPaperDetail,
  getPaperFilePath,
  getPapersDir,
  importPaper,
  listPapers,
  removeHighlight,
  renamePaper,
  savePaperNotes,
  setPaperPinned,
  updateHighlight,
} from "./reader/index.js";
