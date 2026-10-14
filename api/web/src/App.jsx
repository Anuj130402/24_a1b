import { NavLink, Route, Routes, Navigate } from 'react-router-dom';

import Browse from './pages/Browse/index.jsx';
import Transaction from './pages/Transaction/index.jsx';
import Audit from './pages/Audit/index.jsx';
import Analytics from './pages/Analytics/index.jsx';
import MapScreen from './pages/MapScreen/index.jsx';
import Reviews from './pages/Reviews/index.jsx';

// Three roles from docs/design/wireframes.html. Switching only changes
// which screens are highlighted — there is no authentication, which the
// assignment explicitly allows.
const NAV = [
  { to: '/browse',    label: 'Browse',    role: 'Front desk' },
  { to: '/book',      label: 'Book',      role: 'Front desk' },
  { to: '/audit',     label: 'Audit',     role: 'Front desk' },
  { to: '/analytics', label: 'Analytics', role: 'Administrator' },
  { to: '/map',       label: 'Map',       role: 'Dispatch' },
  { to: '/reviews',   label: 'Reviews',   role: 'Administrator' },
];

export default function App() {
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar__brand">CareConnect</div>
        <div className="sidebar__actor">Telemedicine operations</div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              isActive ? 'sidebar__link is-active' : 'sidebar__link'}
          >
            {n.label}
          </NavLink>
        ))}
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
