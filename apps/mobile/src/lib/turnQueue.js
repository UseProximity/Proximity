// The matchmaking store's serialized request queue (see store/chatStore.js). No imports,
// so it can be tested with Node alone.
//
// Tasks run one after another. A task belongs to the epoch it was queued under; the epoch
// moves whenever the signed-in identity changes. A task that has not started by then is
// skipped, and one already running is handed isStale() so it can drop its result instead of
// writing the previous identity's answer into the new one's state. A task that starts while
// nobody is signed in is skipped too: the token is read when a request goes out, so it
// would otherwise be sent with none and answered as an anonymous visitor chat.
export function createTurnQueue({ getEpoch, isSignedIn, onSignedOut }) {
  let chain = Promise.resolve();
  return function enqueue(task) {
    const queuedIn = getEpoch();
    const isStale = () => getEpoch() !== queuedIn;
    const run = () => {
      if (isStale()) return undefined;
      if (!isSignedIn()) {
        onSignedOut();
        return undefined;
      }
      return task(isStale);
    };
    chain = chain.then(run, run);
    return chain;
  };
}
