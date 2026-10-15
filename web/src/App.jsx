import { useState } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';

import Browse from './pages/Browse/index.jsx';
import Transaction from './pages/Transaction/index.jsx';
import Audit from './pages/Audit/index.jsx';
import Analytics from './pages/Analytics/index.jsx';
import MapScreen from './pages/MapScreen/index.jsx';
import Reviews from './pages/Reviews/index.jsx';
import { EmptyState, Button, PageHeader } from './components';

// The three actors from docs/design/wireframes.html, plus an "All roles"
// option for walkthroughs. Switching actor is for demonstration only — the
// assignment does not require real login — but a role that does not restrict
// anything is not a role, so screens outside the current actor's remit are
// blocked rather than merely de-emphasised.
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

/**
 * Shown instead of a screen the current actor may not open. This covers the
 * case the nav cannot: typing the URL directly, using browser history, or
 * switching actor while already standing on a screen they have just lost.
 */
function NotForThisRole({ actorKey, actors, onSwitch, path }) {
  const label = actors[actorKey].label;
  const screenName = NAV.find((n) => n.to === path)?.label ?? 'This screen';
  const whoCan = Object.entries(actors)
    .filter(([key, a]) => key !== 'all' && a.screens.includes(path))
    .map(([, a]) => a.label);

  return (
    <>
      <PageHeader
        title={screenName}
        subtitle={`Not available to the ${label.toLowerCase()}.`}
      />
      <EmptyState
        title="This screen belongs to another role"
        text={
          whoCan.length
            ? `${screenName} is used by the ${whoCan.join(' and ')}.`
            : `${screenName} is not part of this role.`
        }
        action={
          <Button onClick={() => onSwitch('all')}>Switch to all roles</Button>
        }
      />
    </>
  );
}

export default function App() {
  const [actor, setActor] = useState('all');
  const current = ACTORS[actor];
  const { pathname } = useLocation();

  const allowed = (path) => current.screens.includes(path);

  /** Renders the screen, or the block notice if this actor may not open it. */
  const guard = (path, element) =>
    allowed(path)
      ? element
      : (
        <NotForThisRole
          actorKey={actor}
          actors={ACTORS}
          onSwitch={setActor}
          path={path}
        />
      );

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
          if (allowed(n.to)) {
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  isActive ? 'sidebar__link is-active' : 'sidebar__link'}
              >
                {n.label}
              </NavLink>
            );
          }
          // Not a link at all: nothing to click, and it is removed from the
          // tab order so keyboard navigation skips it too.
          return (
            <span
              key={n.to}
              className="sidebar__link sidebar__link--locked"
              aria-disabled="true"
              title={`Not available to the ${current.label.toLowerCase()}`}
            >
              {n.label}
              <span className="sidebar__lock" aria-hidden="true">·</span>
            </span>
          );
        })}
      </nav>

      <main className="main">
        <div className="main__inner">
          <Routes>
            <Route path="/" element={<Navigate to="/browse" replace />} />
            <Route path="/browse" element={guard('/browse', <Browse />)} />
            <Route path="/book" element={guard('/book', <Transaction />)} />
            <Route path="/audit" element={guard('/audit', <Audit />)} />
            <Route path="/analytics" element={guard('/analytics', <Analytics />)} />
            <Route path="/map" element={guard('/map', <MapScreen />)} />
            <Route path="/reviews" element={guard('/reviews', <Reviews />)} />
            <Route path="*" element={<Navigate to="/browse" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
