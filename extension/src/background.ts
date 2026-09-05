// The side panel is the connection; this worker only wires the toolbar icon
// to it and must never talk to the session itself.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
