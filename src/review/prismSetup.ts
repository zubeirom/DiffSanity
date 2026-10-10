// Must run before Prism loads so it does not auto-highlight the page.
(globalThis as { Prism?: { manual?: boolean; disableWorkerMessageHandler?: boolean } }).Prism = {
  manual: true,
  disableWorkerMessageHandler: true,
};
