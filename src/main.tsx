import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import App from './App';
import { boot } from './lib/store';

// Ask the browser not to evict our offline data under storage pressure.
navigator.storage?.persist?.().catch(() => {});

void boot();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
