import { useState } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';

import Browse from './pages/Browse/index.jsx';
import Transaction from './pages/Transaction/index.jsx';
import Audit from './pages/Audit/index.jsx';
import Analytics from './pages/Analytics/index.jsx';
import MapScreen from './pages/MapScreen/index.jsx';
import Reviews from './pages/Reviews/index.jsx';

// The three actors from docs/design/wireframes.html. Switching actor is
// for demonstration only — the assignment does not require real login.
// It changes which screens are foregrounded, not what the API allows.
const ACTORS = {
  all: {
    label: 'All roles',
    blurb: 'Every screen, for walkthroughs',
    screens: ['/browse', '/book', '/audit', '/analytics', '/map', '/reviews'],
  },
  frontdesk: {
    label: 'Front-desk coordinator',
    blurb: 'Checks patients in, takes copays',
    screens: ['/browse', '/book', '/audit'],
  },
  admin: {
    label: 'Clinic administrator',
    blurb: 'Watches revenue and patient sentiment',
    screens: ['/analytics', '/reviews', '/browse'],
  },
  dispatch: {
    label: 'Dispatch coordinator',
    blurb: 'Sends mobile nurses to patients',
    screens: ['/map', '/browse'],
  },
};

const NAV = [
  { to: '/browse', label: 'Browse' },
  { to: '/book', label: 'Book' },
  { to: '/audit', label: 'Audit' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/map', label: 'Map' },
  { to: '/reviews', label: 'Reviews' },
];

export default function App() {
  const [actor, setActor] = useState('all');
  const current = ACTORS[actor];

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar__brand">CareConnect</div>

        <div className="sidebar__switcher">
          <label className="field__label" htmlFor="actor">Acting as</label>
          <select
            id="actor"
            className="select"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
          >
            {Object.entries(ACTORS).map(([key, a]) => (
              <option key={key} value={key}>{a.label}</option>
            ))}
          </select>
          <div className="sidebar__blurb">{current.blurb}</div>
        </div>

        {NAV.map((n) => {
          // Screens outside the current role stay reachable but are
          // de-emphasised, so switching actor never looks like a broken app.
          const inRole = current.screens.includes(n.to);
          return (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                isActive ? 'sidebar__link is-active' : 'sidebar__link'}
              style={inRole ? undefined : { opacity: 0.45 }}
              title={inRole ? undefined : `Not a ${current.label} screen`}
            >
              {n.label}
            </NavLink>
          );
        })}
      </nav>

      <main className="main">
        <div className="main__inner">
          <Routes>
            <Route path="/" element={<Navigate to="/browse" replace />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/book" element={<Transaction />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/map" element={<MapScreen />} />
            <Route path="/reviews" element={<Reviews />} />
            <Route path="*" element={<Navigate to="/browse" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
