import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import 'leaflet/dist/leaflet.css';
import './styles/tokens.css';
import './styles/base.css';
import App from './App.jsx';

// Design tokens and the Leaflet stylesheet are loaded before the tree mounts.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
