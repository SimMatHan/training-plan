import { useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { BottomNav } from './components/BottomNav';
import { TokenScreen } from './components/TokenScreen';
import { UpdateBanner } from './components/UpdateBanner';
import { PlanProvider } from './data/plan';
import { startSync } from './data/sync';
import { useToken } from './lib/token';
import { AnklePage } from './pages/AnklePage';
import { ExerciseHistoryPage } from './pages/ExerciseHistoryPage';
import { HistoryPage } from './pages/HistoryPage';
import { SessionRoute } from './pages/SessionLinkPage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
import { WeekPage } from './pages/WeekPage';

export function App() {
  const token = useToken();
  const [location] = useLocation();

  useEffect(() => {
    if (token) startSync();
  }, [token]);

  if (!token) return <TokenScreen />;

  return (
    <PlanProvider>
      <Switch>
        <Route path="/session/:id" component={SessionRoute} />
        <Route path="/ankel" component={AnklePage} />
        <Route path="/uge" component={WeekPage} />
        <Route path="/historik/oevelse/:id" component={ExerciseHistoryPage} />
        <Route path="/historik" component={HistoryPage} />
        <Route path="/indstillinger" component={SettingsPage} />
        <Route component={TodayPage} />
      </Switch>
      {/* Under logning fylder timeren bunden; navigationen er "← I dag" i toppen. */}
      {/* Opdateringsbjælken vises ikke midt i en session. */}
      {!location.startsWith('/session/') && <UpdateBanner />}
      {!location.startsWith('/session/') && <BottomNav />}
    </PlanProvider>
  );
}
