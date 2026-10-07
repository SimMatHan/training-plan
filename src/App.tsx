import { Route, Switch } from 'wouter';
import { BottomNav } from './components/BottomNav';
import { TokenScreen } from './components/TokenScreen';
import { PlanProvider } from './data/plan';
import { useToken } from './lib/token';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
import { WeekPage } from './pages/WeekPage';

export function App() {
  const token = useToken();
  if (!token) return <TokenScreen />;

  return (
    <PlanProvider>
      <Switch>
        <Route path="/uge" component={WeekPage} />
        <Route path="/historik" component={HistoryPage} />
        <Route path="/indstillinger" component={SettingsPage} />
        <Route component={TodayPage} />
      </Switch>
      <BottomNav />
    </PlanProvider>
  );
}
