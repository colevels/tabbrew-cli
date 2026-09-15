// Test files spawn the real CLI as a subprocess and inherit process.env, so
// this keeps them from making real network calls via the update notifier.
process.env.TABBREW_NO_UPDATE_CHECK = '1'
