// Global app state — single source of truth
const State = {
  // Editor
  openTabs:      [],       // [{path, name, dirty, icon, cmView}]
  activeTab:     null,     // path string

  // Sidebar
  sidebarView:   'explorer',
  expandedDirs:  new Set(),

  // Chat
  chatHistory:   [],       // [{role, content}]
  lastCodeBlock: null,

  // Tasks
  allTasks:      [],
  activeStreams:  {},       // task_id → EventSource

  // Terminal
  terminals:     [],       // managed by terminal.js

  // UI
  panelVisible:  true,
  chatVisible:   true,
};

window.State = State;