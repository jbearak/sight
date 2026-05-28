/**
 * Entry point for the toolbar-wrap real-layout test harness webview.
 * Mirrors `webview/index.tsx`, but mounts `HarnessApp` (toolbar-only, no
 * data/grid layer). Built to `dist-test/` and never shipped.
 */

import { createRoot } from 'react-dom/client';
import { HarnessApp } from './harness-app.js';

const my_container = document.getElementById('root');

if (!my_container) {
    throw new Error('Toolbar wrap harness root element not found');
}

createRoot(my_container).render(<HarnessApp />);
