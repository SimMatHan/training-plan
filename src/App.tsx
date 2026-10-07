import { useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { BottomNav } from './components/BottomNav';
import { TokenScreen } from './components/TokenScreen';
import { PlanProvider } from './data/plan';
import { startSync } from './data/sync';
import { useToken } from './lib/token';
import { AnklePage } from './pages/AnklePage';
import { HistoryPage } from './pages/HistoryPage';
import { SessionPage } from './pages/SessionPage';
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
        <Route path="/session/:uuid" component={SessionPage} />
        <Route path="/ankel" component={AnklePage} />
        <Route path="/uge" component={WeekPage} />
        <Route path="/historik" component={HistoryPage} />
        <Route path="/indstillinger" component={SettingsPage} />
        <Route component={TodayPage} />
      </Switch>
      {/* Under logning fylder timeren bunden; navigationen er "← I dag" i toppen. */}
      {!location.startsWith('/session/') && <BottomNav />}
    </PlanProvider>
  );
}
