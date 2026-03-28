import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

const my_container = document.getElementById('root');

if (!my_container) {
    throw new Error('Data browser root element not found');
}

createRoot(my_container).render(<App />);
