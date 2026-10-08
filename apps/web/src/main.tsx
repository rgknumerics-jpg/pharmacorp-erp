import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Shop from './portal/Shop';
import Courier from './portal/Courier';
import Pointage from './portal/Pointage';
import LicenseGate from './components/LicenseGate';
import './index.css';

// Application client (/boutique/<pharmacie>) et application livreur (/livreur/<pharmacie>) : écrans distincts de l'ERP.
const m = location.pathname.match(/^\/(boutique|livreur|pointage)\/([a-z0-9-]+)\/?$/i);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {m ? (m[1].toLowerCase() === 'boutique' ? <Shop slug={m[2]} /> : m[1].toLowerCase() === 'pointage' ? <Pointage slug={m[2]} /> : <Courier slug={m[2]} />) : <LicenseGate><App /></LicenseGate>}
  </React.StrictMode>,
);
